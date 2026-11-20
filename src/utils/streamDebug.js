import { isAppDebugEnabled } from './appDebug';
import { appendPersistedLog, recordDebugEvent } from './reloadDebug';

const TAG = '[STREAM_DEBUG]';
const MAX_LINES = 2000;

function push(line) {
  if (typeof window === 'undefined') return;
  if (!window.__STREAM_DEBUG_LOGS) {
    window.__STREAM_DEBUG_LOGS = [];
  }
  const entry = { t: new Date().toISOString(), line };
  window.__STREAM_DEBUG_LOGS.push(entry);
  if (window.__STREAM_DEBUG_LOGS.length > MAX_LINES) {
    window.__STREAM_DEBUG_LOGS.splice(0, window.__STREAM_DEBUG_LOGS.length - MAX_LINES);
  }
}

export function streamDebug(stage, message, data) {
  if (!isAppDebugEnabled()) {
    return;
  }
  const parts = [`${TAG} [${stage}]`, message];
  if (data !== undefined) {
    parts.push(data);
  }
  console.log(...parts);
  const line = `[${stage}] ${message}${
    data !== undefined ? ` | ${typeof data === 'string' ? data : JSON.stringify(data, replacer, 0)}` : ''
  }`;
  try {
    push(line);
    appendPersistedLog(line);
  } catch {
    push(`[${stage}] ${message} | (data not serializable)`);
  }
}

function replacer(_key, value) {
  if (value instanceof ArrayBuffer) {
    return `ArrayBuffer(${value.byteLength})`;
  }
  if (value instanceof Uint8Array) {
    return `Uint8Array(${value.byteLength})`;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

export function streamDebugError(stage, message, error) {
  if (!isAppDebugEnabled()) {
    return;
  }
  const detail = error?.stack || error?.message || String(error);
  console.error(`${TAG} [${stage}]`, message, error);
  const line = `[${stage}] ERROR: ${message} | ${detail}`;
  push(line);
  appendPersistedLog(line);
}

/** Call from console: copyStreamDebugLogs() or copyReloadDebugReport() */
export function installStreamDebugHelpers() {
  if (typeof window === 'undefined') return;
  window.copyReloadDebugReport = async () => {
    const { buildDebugReport, copyDebugReport } = await import('./reloadDebug');
    const result = await copyDebugReport();
    if (!result.ok) {
      console.log(await buildDebugReport());
    }
    return result;
  };
  window.copyStreamDebugLogs = () => {
    const text = (window.__STREAM_DEBUG_LOGS || [])
      .map((e) => `${e.t} ${e.line}`)
      .join('\n');
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text);
    }
    console.log(text);
    return Promise.resolve();
  };
  window.dumpStreamDebugLogs = () => {
    console.table(window.__STREAM_DEBUG_LOGS || []);
  };
  window.resetStreamServiceWorker = async () => {
    const regs = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((regs || []).map((r) => r.unregister()));
    sessionStorage.removeItem('stream-sw-reload-attempted'); // STREAM_SW_RELOAD_KEY in streamBridge
    recordDebugEvent('reload_scheduled', { source: 'resetStreamServiceWorker' });
    window.location.reload();
  };
  streamDebug(
    'init',
    'Helpers: copyReloadDebugReport(), copyStreamDebugLogs(), dumpStreamDebugLogs(), resetStreamServiceWorker()'
  );
}