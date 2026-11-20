import { downloadSmallTelegramFile } from './downloadSmallTelegramFile';
import {
  hydrateIndexedDbFromSqliteThumbs,
  listIndexedDbPostersForChat,
} from './thumbnailCache';
import {
  copyPosterRow,
  createEmptyThumbsDatabase,
  ensureThumbsUpdatedAtFromTelegram,
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

function remoteTimestampMs(remoteDb, editDateUnix) {
  return getThumbsUpdatedAt(remoteDb) ?? (editDateUnix ? editDateUnix * 1000 : 0);
}

async function applyRemoteThumbsDb(slot, chatId, SQL, remote, { hydrateIdb = true } = {}) {
  const remoteDb = openThumbsDatabase(SQL, remote.bytes);
  ensureThumbsUpdatedAtFromTelegram(remoteDb, remote.editDateUnix);
  const remoteTs = remoteTimestampMs(remoteDb, remote.editDateUnix);

  if (slot.db) {
    slot.db.close();
  }
  slot.db = remoteDb;
  slot.remoteIsAuthoritative = true;

  const bytes = exportThumbsDatabase(remoteDb);
  await writeCachedDbFile(chatId, bytes, remoteTs);

  if (hydrateIdb) {
    await hydrateIndexedDbFromSqliteThumbs(chatId, slot.db);
  }
  return remoteTs;
}

async function applyLocalThumbsDb(slot, chatId, localDb) {
  if (slot.db && slot.db !== localDb) {
    slot.db.close();
  }
  slot.db = localDb;
  slot.remoteIsAuthoritative = false;
  const localTs = getThumbsUpdatedAt(localDb) ?? 0;
  await writeCachedDbFile(chatId, exportThumbsDatabase(localDb), localTs || undefined);
  return localTs;
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
      remoteIsAuthoritative: false,
    });
  }
  return stores.get(chatId);
}

async function resolveThumbsWithTelegram(client, chatId, slot, SQL, localDb, localTs) {
  slot.messageId = await findThumbsMessageIdWithRetry(client, chatId);

  if (!slot.messageId) {
    await applyLocalThumbsDb(slot, chatId, localDb);
    return;
  }

  try {
    const remote = await downloadThumbsDocument(client, chatId, slot.messageId);
    if (!remote?.bytes?.byteLength) {
      await applyLocalThumbsDb(slot, chatId, localDb);
      return;
    }

    const remoteDb = openThumbsDatabase(SQL, remote.bytes);
    ensureThumbsUpdatedAtFromTelegram(remoteDb, remote.editDateUnix);
    const remoteTs = remoteTimestampMs(remoteDb, remote.editDateUnix);

    if (remoteTs > localTs) {
      remoteDb.close();
      await applyRemoteThumbsDb(slot, chatId, SQL, remote);
      slot.dirty = false;
      return;
    }

    remoteDb.close();

    if (localTs > remoteTs) {
      await applyLocalThumbsDb(slot, chatId, localDb);
      slot.dirty = false;
      return;
    }

    // Same timestamp: merge any posters missing on either side, keep single message + local db.
    await mergePostersBothWays(localDb, SQL, remote);
    await applyLocalThumbsDb(slot, chatId, localDb);
  } catch (error) {
    console.warn('Failed to download thumbs.db from Telegram:', error);
    await applyLocalThumbsDb(slot, chatId, localDb);
  }
}

async function mergePostersBothWays(localDb, SQL, remote) {
  const remoteDb = openThumbsDatabase(SQL, remote.bytes);
  try {
    for (const key of listPosterKeys(remoteDb)) {
      if (!getPosterRow(localDb, key.chatId, key.messageId)) {
        await copyPosterRow(remoteDb, key.chatId, key.messageId, key.chatId, key.messageId);
      }
    }
    setThumbsUpdatedAt(localDb);
  } finally {
    remoteDb.close();
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

    const cached = await readCachedDbFile(chatId);
    let localDb;
    let localTs = 0;

    if (cached?.bytes?.byteLength) {
      localDb = openThumbsDatabase(SQL, cached.bytes);
      localTs = getThumbsUpdatedAt(localDb) ?? 0;
    } else {
      localDb = createEmptyThumbsDatabase(SQL);
      localTs = 0;
    }

    await resolveThumbsWithTelegram(client, chatId, slot, SQL, localDb, localTs);

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

    const localTs = getThumbsUpdatedAt(slot.db) ?? 0;

    slot.messageId =
      slot.messageId ?? (await findThumbsMessageIdWithRetry(client, chatId));

    if (slot.messageId) {
      try {
        const remote = await downloadThumbsDocument(client, chatId, slot.messageId);
        if (remote?.bytes?.byteLength) {
          const remoteDb = openThumbsDatabase(slot.SQL, remote.bytes);
          ensureThumbsUpdatedAtFromTelegram(remoteDb, remote.editDateUnix);
          const remoteTs = remoteTimestampMs(remoteDb, remote.editDateUnix);
          remoteDb.close();

          if (remoteTs > localTs) {
            await applyRemoteThumbsDb(slot, chatId, slot.SQL, remote);
            slot.dirty = false;
            console.warn(
              'Telegram thumbs.db is newer; refreshed local copy instead of uploading.',
            );
            return false;
          }
        }
      } catch (error) {
        console.warn('thumbs.db remote check before upload failed:', error);
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
    slot.remoteIsAuthoritative = false;
    return true;
  } finally {
    slot.syncing = false;
  }
}

export async function ensureTelegramThumbsStore(client, chatId) {
  if (!client || !chatId) {
    return { importedFromBrowser: 0 };
  }
  const slot = await loadThumbsStore(client, chatId);

  let importedFromBrowser = 0;
  if (!slot.remoteIsAuthoritative) {
    importedFromBrowser = await importBrowserPostersIntoThumbsDb(client, chatId);
  }

  return { importedFromBrowser, remoteIsAuthoritative: slot.remoteIsAuthoritative };
}

async function importBrowserPostersIntoThumbsDb(client, chatId) {
  const records = await listIndexedDbPostersForChat(chatId);
  if (records.length === 0) {
    return 0;
  }

  const slot = await loadThumbsStore(client, chatId);
  let imported = 0;

  for (const row of records) {
    if (getPosterRow(slot.db, chatId, row.messageId)) {
      continue;
    }
    await setPosterRow(slot.db, chatId, row.messageId, row.blob, {
      durationSec: row.durationSec,
      source: row.source,
    });
    imported += 1;
  }

  if (imported > 0) {
    const updatedAtMs = getThumbsUpdatedAt(slot.db) ?? Date.now();
    await writeCachedDbFile(chatId, exportThumbsDatabase(slot.db), updatedAtMs);
    scheduleThumbsSync(client, chatId);
  }

  return imported;
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