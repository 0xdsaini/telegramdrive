const DB_NAME = 'gramsafe-thumbnails';
const DB_VERSION = 1;
const STORE = 'posters';
const MAX_ENTRIES = 300;

function cacheKey(chatId, messageId) {
  return `${chatId}:${messageId}`;
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('accessedAt', 'accessedAt', { unique: false });
      }
    };
  });
}

function withStore(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let innerResult;
        tx.oncomplete = () => resolve(innerResult);
        tx.onerror = () => reject(tx.error);
        Promise.resolve(fn(store, tx))
          .then((r) => {
            innerResult = r;
          })
          .catch(reject);
      }),
  );
}

function evictOldest(store, removeCount) {
  return new Promise((resolve, reject) => {
    const index = store.index('accessedAt');
    const cursorReq = index.openCursor();
    let removed = 0;
    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor || removed >= removeCount) {
        resolve();
        return;
      }
      store.delete(cursor.primaryKey);
      removed += 1;
      cursor.continue();
    };
    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

/**
 * @returns {Promise<{ blob: Blob, durationSec: number|null, source: string }|null>}
 */
export async function getCachedPoster(chatId, messageId) {
  const client = typeof window !== 'undefined' ? window.tdClient : null;
  if (client) {
    const { ensureTelegramThumbsStore, getPosterFromThumbsDb } = await import(
      './telegramThumbsStore'
    );
    await ensureTelegramThumbsStore(client, chatId);
    const fromThumbsDb = await getPosterFromThumbsDb(client, chatId, messageId);
    if (fromThumbsDb?.blob) {
      await setCachedPoster(chatId, messageId, fromThumbsDb.blob, {
        durationSec: fromThumbsDb.durationSec,
        source: fromThumbsDb.source,
        skipTelegram: true,
        overwrite: true,
      });
      return {
        blob: fromThumbsDb.blob,
        durationSec: fromThumbsDb.durationSec ?? null,
        source: fromThumbsDb.source || 'thumbs-db',
      };
    }
  }

  const key = cacheKey(chatId, messageId);
  const record = await withStore('readonly', (store) =>
    new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }),
  );

  if (record?.blob) {
    const now = Date.now();
    await withStore('readwrite', (store) => {
      store.put({ ...record, accessedAt: now });
    });

    return {
      blob: record.blob,
      durationSec: record.durationSec ?? null,
      source: record.source || 'cache',
    };
  }

  return null;
}

export async function listIndexedDbPostersForChat(chatId) {
  const prefix = `${chatId}:`;
  return withStore('readonly', (store) =>
    new Promise((resolve, reject) => {
      const out = [];
      const req = store.openCursor();
      req.onsuccess = (event) => {
        const cursor = event.target.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        const row = cursor.value;
        if (row?.key?.startsWith(prefix) && row.blob) {
          const messageId = parseInt(row.key.slice(prefix.length), 10);
          if (!Number.isNaN(messageId)) {
            out.push({
              messageId,
              blob: row.blob,
              durationSec: row.durationSec ?? null,
              source: row.source || 'cache',
            });
          }
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    }),
  );
}

/**
 * When Telegram thumbs.db wins (newer), copy all posters into browser IndexedDB.
 */
export async function hydrateIndexedDbFromSqliteThumbs(
  chatId,
  sqliteDb,
  { overwrite = true } = {},
) {
  const { getPosterRow, listPosterKeys } = await import('./thumbsDbSql');
  const keys = listPosterKeys(sqliteDb);
  await Promise.all(
    keys
      .filter((k) => k.chatId === chatId)
      .map(async ({ chatId: cId, messageId }) => {
        const row = getPosterRow(sqliteDb, cId, messageId);
        if (!row?.blob) {
          return;
        }
        await setCachedPoster(cId, messageId, row.blob, {
          durationSec: row.durationSec,
          source: row.source,
          skipTelegram: true,
          overwrite,
        });
      }),
  );
}

export async function deleteCachedPoster(chatId, messageId) {
  const key = cacheKey(chatId, messageId);
  await withStore('readwrite', (store) => {
    store.delete(key);
  });
}

export async function setCachedPoster(
  chatId,
  messageId,
  blob,
  {
    durationSec = null,
    source = 'tdlib',
    skipTelegram = false,
    overwrite = false,
  } = {},
) {
  const key = cacheKey(chatId, messageId);
  const now = Date.now();

  let wrote = false;

  await withStore('readwrite', async (store) => {
    const count = await new Promise((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const existing = await new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (existing?.blob && !overwrite) {
      return;
    }

    if (!existing && count >= MAX_ENTRIES) {
      await evictOldest(store, count - MAX_ENTRIES + 1);
    }

    store.put({
      key,
      blob,
      durationSec,
      source,
      accessedAt: now,
      createdAt: existing?.createdAt ?? now,
    });
    wrote = true;
  });

  if (!skipTelegram && wrote) {
    const client = typeof window !== 'undefined' ? window.tdClient : null;
    if (client) {
      try {
        const { setPosterInThumbsDb } = await import('./telegramThumbsStore');
        await setPosterInThumbsDb(client, chatId, messageId, blob, {
          durationSec,
          source,
        });
      } catch (error) {
        console.warn('Failed to persist poster to thumbs.db:', error);
      }
    }
  }
}