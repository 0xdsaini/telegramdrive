/**
 * App-wide verbose diagnostics. Off by default for mobile performance.
 *
 * Enable:  ?debug=1  (stored in localStorage until ?debug=0)
 * Disable: ?debug=0
 */

const STORAGE_KEY = 'gramsafe-app-debug';

/** @type {boolean|null} */
let cachedEnabled = null;

export function isAppDebugEnabled() {
  if (cachedEnabled !== null) {
    return cachedEnabled;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === '1') {
      localStorage.setItem(STORAGE_KEY, '1');
      cachedEnabled = true;
      return true;
    }
    if (params.get('debug') === '0') {
      localStorage.removeItem(STORAGE_KEY);
      cachedEnabled = false;
      return false;
    }
    cachedEnabled = localStorage.getItem(STORAGE_KEY) === '1';
    return cachedEnabled;
  } catch {
    cachedEnabled = false;
    return false;
  }
}

export function debugLog(...args) {
  if (isAppDebugEnabled()) {
    console.log(...args);
  }
}

export function debugWarn(...args) {
  if (isAppDebugEnabled()) {
    console.warn(...args);
  }
}

export function debugError(...args) {
  if (isAppDebugEnabled()) {
    console.error(...args);
  }
}

/** Tell progressive-sw.js to stop console + postMessage logging. */
export function syncStreamSwDebugFlag() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) {
    return;
  }
  const payload = { type: 'STREAM_DEBUG_FLAG', enabled: isAppDebugEnabled() };
  try {
    navigator.serviceWorker.controller?.postMessage(payload);
  } catch {
    /* ignore */
  }
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => {
      for (const reg of regs) {
        try {
          reg.active?.postMessage(payload);
          reg.waiting?.postMessage(payload);
          reg.installing?.postMessage(payload);
        } catch {
          /* ignore */
        }
      }
    })
    .catch(() => {});
}

export function initAppDebug() {
  syncStreamSwDebugFlag();
  if (isAppDebugEnabled()) {
    console.info(
      '[gramsafe] Debug mode is ON (?debug=1). Stream/TDLib verbose logs and persisted debug lines are enabled.',
    );
  }
}