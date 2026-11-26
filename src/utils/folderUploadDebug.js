import { collectTrackedMessageIds, findFolderByPath } from './fileStructureUtils';

export const FOLDER_UPLOAD_DEBUG_STORAGE_KEY = 'tg-drive-folder-upload-debug';
const SESSION_LOG_KEY = 'tg-drive-folder-upload-debug-log';

const MAX_RING = 300;

function ring() {
  if (typeof window === 'undefined') {
    return [];
  }
  if (!Array.isArray(window.__folderUploadDebugLog)) {
    try {
      const saved = sessionStorage.getItem(SESSION_LOG_KEY);
      window.__folderUploadDebugLog = saved ? JSON.parse(saved) : [];
    } catch {
      window.__folderUploadDebugLog = [];
    }
  }
  return window.__folderUploadDebugLog;
}

function persistRing(log) {
  if (typeof sessionStorage === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(SESSION_LOG_KEY, JSON.stringify(log));
  } catch {
    /* quota */
  }
}

export function isFolderUploadDebugEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('folderDebug') === '1') {
      localStorage.setItem(FOLDER_UPLOAD_DEBUG_STORAGE_KEY, '1');
      return true;
    }
    if (params.get('folderDebug') === '0') {
      localStorage.removeItem(FOLDER_UPLOAD_DEBUG_STORAGE_KEY);
      return false;
    }
    if (localStorage.getItem(FOLDER_UPLOAD_DEBUG_STORAGE_KEY) === '1') {
      return true;
    }
    return process.env.NODE_ENV === 'development';
  } catch {
    return process.env.NODE_ENV === 'development';
  }
}

function countFolders(node) {
  if (!node?.subfolders?.length) {
    return 0;
  }
  let total = node.subfolders.length;
  for (const sub of node.subfolders) {
    total += countFolders(sub);
  }
  return total;
}

export function summarizeFileStructure(structure) {
  if (!structure) {
    return null;
  }
  const root = structure;
  return {
    updatedAt: structure.updatedAt ?? null,
    rootFileCount: root.files?.length ?? 0,
    rootSubfolderCount: root.subfolders?.length ?? 0,
    rootSubfolderNames: (root.subfolders ?? []).map((f) => f.name),
    totalSubfolders: countFolders(root),
    trackedMessageIds: [...collectTrackedMessageIds(structure)],
  };
}

export function summarizeFolderView(structure, folderPath) {
  if (!structure) {
    return null;
  }
  const folder = findFolderByPath(structure, folderPath ?? '/');
  if (!folder) {
    return { folderPath, found: false };
  }
  return {
    folderPath: folderPath ?? '/',
    found: true,
    subfolderNames: (folder.subfolders ?? []).map((f) => f.name),
    fileNames: (folder.files ?? []).map((f) => f.filename),
    subfolderCount: folder.subfolders?.length ?? 0,
    fileCount: folder.files?.length ?? 0,
  };
}

/**
 * @param {string} stage
 * @param {Record<string, unknown>} [data]
 */
export function folderUploadDebug(stage, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    stage,
    ...data,
  };
  const log = ring();
  log.push(entry);
  if (log.length > MAX_RING) {
    log.splice(0, log.length - MAX_RING);
  }
  persistRing(log);
  if (isFolderUploadDebugEnabled()) {
    console.log('[folder-upload]', stage, data);
  }
}

export function folderUploadDebugError(stage, error, extra = {}) {
  const message = error?.message ?? String(error);
  folderUploadDebug(`${stage}:error`, {
    message,
    stack: error?.stack,
    ...extra,
  });
  console.error('[folder-upload]', stage, message, error, extra);
}

export function dumpFolderUploadDebug() {
  const log = ring();
  console.log('[folder-upload] dump', log);
  try {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `folder-upload-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.warn('[folder-upload] could not download debug log', e);
  }
  return log;
}

/** @param {boolean | { ok?: boolean }} result */
export function isMetadataSaveOk(result) {
  if (result === true) {
    return true;
  }
  return Boolean(result && typeof result === 'object' && result.ok === true);
}

/** @param {boolean | { reason?: string, message?: string }} result */
export function metadataSaveFailureMessage(result) {
  if (result === true || isMetadataSaveOk(result)) {
    return null;
  }
  if (typeof result !== 'object' || result == null) {
    return 'Metadata save failed (unknown).';
  }
  if (result.reason === 'remote_newer') {
    return 'Metadata save rejected: Telegram copy looks newer. Refresh and retry.';
  }
  if (result.reason === 'exception' && result.message) {
    return `Metadata save error: ${result.message}`;
  }
  return `Metadata save failed (${result.reason ?? 'unknown'}).`;
}

export function attachFolderUploadDebugGlobals() {
  if (typeof window === 'undefined') {
    return;
  }
  window.dumpFolderUploadDebug = dumpFolderUploadDebug;
  window.__folderUploadDebugLog = window.__folderUploadDebugLog ?? [];
  if (isFolderUploadDebugEnabled()) {
    console.info(
      '[folder-upload] Debug ON (?folderDebug=1). Use dumpFolderUploadDebug() to export logs.',
    );
  }
}