import { downloadSmallTelegramFile } from './downloadSmallTelegramFile';
import {
  hydrateIndexedDbFromSqliteThumbs,
  listIndexedDbPostersForChat,
} from './thumbnailCache';
import {
  copyPosterRow,
  createEmptyThumbsDatabase,
  exportThumbsDatabase,
  getPosterRow,
  getThumbsUpdatedAt,
  listPosterKeys,
  loadSqlModule,
  openThumbsDatabase,
  setPosterRow,
  setThumbsUpdatedAt,
} from './thumbsDbSql';

export const THUMBNAILS_MARKER = 'THUMBNAILS_STORAGE';
export const THUMBS_DB_FILENAME = 'thumbs.db';

const THUMBS_MESSAGE_KEY_PREFIX = 'telegram-thumbs-message-id';
const LOCAL_DB_CACHE_NAME = 'gramsafe-thumbs-db-file';
const LOCAL_DB_STORE = 'files';
const SYNC_DEBOUNCE_MS = 2500;

const stores = new Map();

function messageStorageKey(chatId) {
  return `${THUMBS_MESSAGE_KEY_PREFIX}-${chatId}`;
}

function openLocalDbCache() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB_CACHE_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(LOCAL_DB_STORE)) {
        db.createObjectStore(LOCAL_DB_STORE, { keyPath: 'chatId' });
      }
    };
  });
}

async function readCachedDbFile(chatId) {
  const db = await openLocalDbCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_DB_STORE, 'readonly');
    const req = tx.objectStore(LOCAL_DB_STORE).get(chatId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function writeCachedDbFile(chatId, bytes, updatedAtMs) {
  const db = await openLocalDbCache();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCAL_DB_STORE, 'readwrite');
    tx.objectStore(LOCAL_DB_STORE).put({
      chatId,
      bytes,
      updatedAtMs: updatedAtMs ?? Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getContentCaptionText(content) {
  const text = content?.caption?.text;
  return typeof text === 'string' ? text.trim() : '';
}

function isThumbsStorageMessage(message) {
  if (!message?.content) {
    return false;
  }
  const caption = getContentCaptionText(message.content);
  if (caption.includes(THUMBNAILS_MARKER)) {
    return true;
  }
  const fileName = message.content.document?.file_name;
  return fileName === THUMBS_DB_FILENAME;
}

function rememberThumbsMessageId(chatId, messageId) {
  if (messageId != null) {
    localStorage.setItem(messageStorageKey(chatId), String(messageId));
  }
  return messageId;
}

function pickCanonicalThumbsMessage(messages) {
  const matches = (messages ?? []).filter(isThumbsStorageMessage);
  if (matches.length === 0) {
    return null;
  }
  return matches.reduce((oldest, msg) => (msg.id < oldest.id ? msg : oldest));
}

async function searchThumbsMessageViaHistory(client, chatId) {
  let fromMessageId = 0;
  const maxAttempts = 8;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const historyResult = await client.send({
      '@type': 'getChatHistory',
      chat_id: chatId,
      from_message_id: fromMessageId,
      offset: 0,
      limit: 50,
      only_local: false,
    });

    const found = pickCanonicalThumbsMessage(historyResult?.messages);
    if (found) {
      return found.id;
    }

    const messages = historyResult?.messages ?? [];
    if (messages.length < 50) {
      break;
    }
    fromMessageId = messages[messages.length - 1].id;
  }

  return null;
}

/**
 * Single canonical thumbs.db message per chat (oldest match). Persisted like metadata message id.
 */
async function findThumbsMessageId(client, chatId) {
  const saved = localStorage.getItem(messageStorageKey(chatId));
  if (saved) {
    try {
      const message = await client.send({
        '@type': 'getMessage',
        chat_id: chatId,
        message_id: parseInt(saved, 10),
      });
      if (message && isThumbsStorageMessage(message)) {
        return rememberThumbsMessageId(chatId, message.id);
      }
    } catch {
      /* search again */
    }
  }

  try {
    const search = await client.send({
      '@type': 'searchChatMessages',
      chat_id: chatId,
      query: THUMBNAILS_MARKER,
      limit: 50,
      from_message_id: 0,
      offset: 0,
      only_missed: false,
    });
    const canonical = pickCanonicalThumbsMessage(search?.messages);
    if (canonical) {
      return rememberThumbsMessageId(chatId, canonical.id);
    }
  } catch (error) {
    console.warn('searchChatMessages for thumbs.db failed:', error);
  }

  try {
    const fromHistory = await searchThumbsMessageViaHistory(client, chatId);
    if (fromHistory) {
      return rememberThumbsMessageId(chatId, fromHistory);
    }
  } catch (error) {
    console.warn('getChatHistory for thumbs.db failed:', error);
  }

  return null;
}

async function findThumbsMessageIdWithRetry(client, chatId, { attempts = 4, delayMs = 1200 } = {}) {
  for (let i = 0; i < attempts; i += 1) {
    const id = await findThumbsMessageId(client, chatId);
    if (id) {
      return id;
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return null;
}

async function downloadThumbsDocument(client, chatId, thumbsMessageId) {
  const message = await client.send({
    '@type': 'getMessage',
    chat_id: chatId,
    message_id: thumbsMessageId,
  });
  if (!message?.content?.document) {
    return null;
  }

  const fileId = message.content.document.document?.id;
  if (!fileId) {
    return null;
  }

  const blob = await downloadSmallTelegramFile(client, fileId, {
    mimeType: 'application/octet-stream',
    maxWaitMs: 180_000,
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const editDateUnix =
    message.edit_date > 0 ? message.edit_date : message.date;

  return { bytes, editDateUnix };
}

/** Add posters from secondary into primary where primary has no entry (set union). */
async function unionMergeGapsOnly(primaryDb, secondaryDb) {
  let added = 0;
  for (const key of listPosterKeys(secondaryDb)) {
    if (!getPosterRow(primaryDb, key.chatId, key.messageId)) {
      await copyPosterRow(
        secondaryDb,
        key.chatId,
        key.messageId,
        key.chatId,
        key.messageId,
      );
      added += 1;
    }
  }
  return added;
}

/** Always edit an existing message when possible — never create a duplicate file in chat. */
async function persistThumbsDbToTelegram(client, chatId, slot, bytes) {
  let messageId =
    slot.messageId ?? (await findThumbsMessageIdWithRetry(client, chatId));
  const file = new File([bytes], THUMBS_DB_FILENAME, {
    type: 'application/octet-stream',
  });

  if (messageId) {
    slot.messageId = messageId;
    await client.send({
      '@type': 'editMessageMedia',
      chat_id: chatId,
      message_id: messageId,
      input_message_content: {
        '@type': 'inputMessageDocument',
        document: {
          '@type': 'inputFileBlob',
          name: THUMBS_DB_FILENAME,
          data: file,
        },
        caption: {
          '@type': 'formattedText',
          text: THUMBNAILS_MARKER,
        },
      },
    });
    rememberThumbsMessageId(chatId, messageId);
    return messageId;
  }

  console.warn(
    'No thumbs.db message found after retries — creating the first one in chat.',
  );

  await client.send({
    '@type': 'sendMessage',
    chat_id: chatId,
    input_message_content: {
      '@type': 'inputMessageDocument',
      document: {
        '@type': 'inputFileBlob',
        name: THUMBS_DB_FILENAME,
        data: file,
      },
      caption: {
        '@type': 'formattedText',
        text: THUMBNAILS_MARKER,
      },
    },
  });

  messageId = await findThumbsMessageIdWithRetry(client, chatId, {
    attempts: 6,
    delayMs: 1500,
  });
  if (messageId) {
    slot.messageId = messageId;
    rememberThumbsMessageId(chatId, messageId);
  }
  return messageId;
}

function getStore(chatId) {
  if (!stores.has(chatId)) {
    stores.set(chatId, {
      db: null,
      SQL: null,
      messageId: null,
      loadPromise: null,
      syncTimer: null,
      syncing: false,
      dirty: false,
    });
  }
  return stores.get(chatId);
}

/**
 * Load thumbs.db from Telegram first, then union local cache + IndexedDB extras (maximize hits).
 */
async function buildUnionThumbsDatabase(client, chatId, slot, SQL) {
  slot.messageId = await findThumbsMessageIdWithRetry(client, chatId);

  let mergedDb = createEmptyThumbsDatabase(SQL);

  const closeWorking = (db) => {
    if (db && db !== mergedDb) {
      db.close();
    }
  };

  if (slot.messageId) {
    try {
      const remote = await downloadThumbsDocument(client, chatId, slot.messageId);
      if (remote?.bytes?.byteLength) {
        mergedDb.close();
        mergedDb = openThumbsDatabase(SQL, remote.bytes);
      }
    } catch (error) {
      console.warn('Failed to download thumbs.db from Telegram:', error);
    }
  }

  const cached = await readCachedDbFile(chatId);
  if (cached?.bytes?.byteLength) {
    const cachedDb = openThumbsDatabase(SQL, cached.bytes);
    await unionMergeGapsOnly(mergedDb, cachedDb);
    closeWorking(cachedDb);
  }

  let addedFromBrowser = 0;
  const idbRecords = await listIndexedDbPostersForChat(chatId);
  for (const row of idbRecords) {
    if (getPosterRow(mergedDb, chatId, row.messageId)) {
      continue;
    }
    await setPosterRow(mergedDb, chatId, row.messageId, row.blob, {
      durationSec: row.durationSec,
      source: row.source,
    });
    addedFromBrowser += 1;
  }

  if (slot.db && slot.db !== mergedDb) {
    slot.db.close();
  }
  slot.db = mergedDb;
  setThumbsUpdatedAt(mergedDb);

  await hydrateIndexedDbFromSqliteThumbs(chatId, mergedDb, { overwrite: true });

  const bytes = exportThumbsDatabase(mergedDb);
  await writeCachedDbFile(chatId, bytes, getThumbsUpdatedAt(mergedDb) ?? Date.now());

  if (addedFromBrowser > 0) {
    slot.dirty = true;
    scheduleThumbsSync(client, chatId);
  }
}

async function loadThumbsStore(client, chatId) {
  const slot = getStore(chatId);
  if (slot.db) {
    return slot;
  }
  if (slot.loadPromise) {
    await slot.loadPromise;
    return slot;
  }

  slot.loadPromise = (async () => {
    const SQL = await loadSqlModule();
    slot.SQL = SQL;
    await buildUnionThumbsDatabase(client, chatId, slot, SQL);
    slot.loadPromise = null;
  })();

  await slot.loadPromise;
  return slot;
}

function scheduleThumbsSync(client, chatId) {
  const slot = getStore(chatId);
  slot.dirty = true;
  if (slot.syncTimer) {
    clearTimeout(slot.syncTimer);
  }
  slot.syncTimer = setTimeout(() => {
    slot.syncTimer = null;
    syncThumbsToTelegram(client, chatId).catch((error) => {
      console.warn('thumbs.db sync failed:', error);
    });
  }, SYNC_DEBOUNCE_MS);
}

export async function syncThumbsToTelegram(client, chatId) {
  if (!client || !chatId) {
    return false;
  }

  const slot = getStore(chatId);
  if (!slot.db || slot.syncing) {
    return false;
  }
  if (!slot.dirty) {
    return true;
  }

  slot.syncing = true;
  try {
    await loadThumbsStore(client, chatId);

    slot.messageId =
      slot.messageId ?? (await findThumbsMessageIdWithRetry(client, chatId));

    if (slot.messageId) {
      try {
        const remote = await downloadThumbsDocument(client, chatId, slot.messageId);
        if (remote?.bytes?.byteLength) {
          const remoteDb = openThumbsDatabase(slot.SQL, remote.bytes);
          await unionMergeGapsOnly(slot.db, remoteDb);
          remoteDb.close();
        }
      } catch (error) {
        console.warn('thumbs.db remote union before upload failed:', error);
      }
    }

    if (listPosterKeys(slot.db).length === 0) {
      slot.dirty = false;
      return false;
    }

    setThumbsUpdatedAt(slot.db);
    const uploadBytes = exportThumbsDatabase(slot.db);
    const messageId = await persistThumbsDbToTelegram(client, chatId, slot, uploadBytes);

    if (messageId) {
      slot.messageId = messageId;
    }

    await writeCachedDbFile(
      chatId,
      uploadBytes,
      getThumbsUpdatedAt(slot.db) ?? Date.now(),
    );
    slot.dirty = false;
    return true;
  } finally {
    slot.syncing = false;
  }
}

export async function ensureTelegramThumbsStore(client, chatId) {
  if (!client || !chatId) {
    return { posterCount: 0 };
  }
  const slot = await loadThumbsStore(client, chatId);
  return { posterCount: listPosterKeys(slot.db).length };
}

export async function getPosterFromThumbsDb(client, chatId, messageId) {
  if (!client || !chatId || !messageId) {
    return null;
  }
  try {
    const slot = await loadThumbsStore(client, chatId);
    return getPosterRow(slot.db, chatId, messageId);
  } catch (error) {
    console.warn('getPosterFromThumbsDb failed:', error);
    return null;
  }
}

export async function setPosterInThumbsDb(
  client,
  chatId,
  messageId,
  blob,
  { durationSec = null, source = 'client-stream' } = {},
) {
  if (!client || !chatId || !messageId || !blob) {
    return;
  }
  const slot = await loadThumbsStore(client, chatId);
  await setPosterRow(slot.db, chatId, messageId, blob, { durationSec, source });
  const updatedAtMs = getThumbsUpdatedAt(slot.db) ?? Date.now();
  await writeCachedDbFile(chatId, exportThumbsDatabase(slot.db), updatedAtMs);
  scheduleThumbsSync(client, chatId);
}