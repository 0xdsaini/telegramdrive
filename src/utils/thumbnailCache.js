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
  const key = cacheKey(chatId, messageId);
  const record = await withStore('readonly', (store) =>
    new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }),
  );

  if (!record?.blob) {
    return null;
  }

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

export async function setCachedPoster(chatId, messageId, blob, { durationSec = null, source = 'tdlib' } = {}) {
  const key = cacheKey(chatId, messageId);
  const now = Date.now();

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
  });
}