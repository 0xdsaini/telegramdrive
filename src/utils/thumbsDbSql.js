import initSqlJs from 'sql.js';
import { getAppBasePath } from './appBasePath';

let sqlModulePromise = null;

function wasmLooksValid(buffer) {
  if (!buffer || buffer.byteLength < 4) {
    return false;
  }
  const magic = new Uint8Array(buffer, 0, 4);
  return (
    magic[0] === 0x00 && magic[1] === 0x61 && magic[2] === 0x73 && magic[3] === 0x6d
  );
}

async function fetchWasmFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`sql-wasm.wasm HTTP ${response.status} from ${url}`);
  }
  const buffer = await response.arrayBuffer();
  if (!wasmLooksValid(buffer)) {
    throw new Error(`sql-wasm.wasm at ${url} is not WASM (likely index.html — check PUBLIC_URL)`);
  }
  return buffer;
}

function resolveWasmPublicPath() {
  const baked = process.env.PUBLIC_URL;
  if (baked && baked !== '.' && !String(baked).includes('PUBLIC_URL')) {
    const prefix = baked.replace(/\/$/, '');
    return prefix ? `${prefix}/sql-wasm.wasm` : '/sql-wasm.wasm';
  }
  const base = getAppBasePath().replace(/\/$/, '');
  return base ? `${base}/sql-wasm.wasm` : '/sql-wasm.wasm';
}

async function loadSqlWasmBinary() {
  const url = new URL(resolveWasmPublicPath(), window.location.origin).href;
  return fetchWasmFromUrl(url);
}

export async function loadSqlModule() {
  if (!sqlModulePromise) {
    sqlModulePromise = (async () => {
      const wasmBinary = await loadSqlWasmBinary();
      return initSqlJs({ wasmBinary });
    })();
  }
  return sqlModulePromise;
}

export function createEmptyThumbsDatabase(SQL) {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE posters (
      chat_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      jpeg BLOB NOT NULL,
      duration_sec REAL,
      source TEXT,
      PRIMARY KEY (chat_id, message_id)
    );
  `);
  return db;
}

export function openThumbsDatabase(SQL, bytes) {
  if (!bytes || bytes.byteLength === 0) {
    return createEmptyThumbsDatabase(SQL);
  }
  return new SQL.Database(bytes);
}

export function getThumbsUpdatedAt(db) {
  const stmt = db.prepare(`SELECT value FROM meta WHERE key = 'updatedAt'`);
  try {
    if (!stmt.step()) {
      return null;
    }
    const row = stmt.getAsObject();
    const parsed = Date.parse(row.value);
    return Number.isNaN(parsed) ? null : parsed;
  } finally {
    stmt.free();
  }
}

export function setThumbsUpdatedAt(db, date = new Date()) {
  db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('updatedAt', ?)`, [
    date.toISOString(),
  ]);
}

export function ensureThumbsUpdatedAtFromTelegram(db, editDateUnix) {
  if (getThumbsUpdatedAt(db) != null) {
    return;
  }
  if (!editDateUnix) {
    return;
  }
  setThumbsUpdatedAt(db, new Date(editDateUnix * 1000));
}

export function getPosterRow(db, chatId, messageId) {
  const stmt = db.prepare(
    `SELECT jpeg, duration_sec, source FROM posters WHERE chat_id = ? AND message_id = ?`,
  );
  try {
    stmt.bind([chatId, messageId]);
    if (!stmt.step()) {
      return null;
    }
    const [jpeg, durationSec, source] = stmt.get();
    if (!jpeg) {
      return null;
    }
    const blob = new Blob([jpeg], { type: 'image/jpeg' });
    return {
      blob,
      durationSec: typeof durationSec === 'number' ? durationSec : null,
      source: source || 'thumbs-db',
    };
  } finally {
    stmt.free();
  }
}

export async function setPosterRow(
  db,
  chatId,
  messageId,
  blob,
  { durationSec = null, source = 'client-stream' } = {},
) {
  const buffer = await blob.arrayBuffer();
  const jpeg = new Uint8Array(buffer);
  db.run(
    `INSERT OR REPLACE INTO posters (chat_id, message_id, jpeg, duration_sec, source)
     VALUES (?, ?, ?, ?, ?)`,
    [chatId, messageId, jpeg, durationSec, source],
  );
  setThumbsUpdatedAt(db);
}

export function exportThumbsDatabase(db) {
  return db.export();
}

export function listPosterKeys(db) {
  const keys = [];
  const stmt = db.prepare(`SELECT chat_id, message_id FROM posters`);
  try {
    while (stmt.step()) {
      const [chatId, messageId] = stmt.get();
      keys.push({ chatId, messageId });
    }
  } finally {
    stmt.free();
  }
  return keys;
}

export async function copyPosterRow(db, fromChatId, fromMessageId, toChatId, toMessageId) {
  const row = getPosterRow(db, fromChatId, fromMessageId);
  if (!row) {
    return false;
  }
  await setPosterRow(db, toChatId, toMessageId, row.blob, {
    durationSec: row.durationSec,
    source: row.source,
  });
  return true;
}