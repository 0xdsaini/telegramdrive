/**
 * Persists reload / SW diagnostics in localStorage so they survive full page reloads (mobile-friendly).
 * index.html bootstrapping writes the same keys via inline helpers — keep EVENTS_KEY in sync.
 */

import { isAppDebugEnabled } from './appDebug';

export const DEBUG_EVENTS_KEY = 'tg-drive-debug-events';
export const DEBUG_LOGS_KEY = 'tg-drive-debug-logs';
const MAX_EVENTS = 200;
const MAX_LOG_LINES = 500;

function safeParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function navigationType() {
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    return nav?.type || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function isNoSwReloadEnabled() {
  try {
    if (typeof window !== 'undefined') {
      if (new URLSearchParams(window.location.search).get('noSwReload') === '1') {
        localStorage.setItem('tg-drive-no-sw-reload', '1');
        return true;
      }
    }
    return localStorage.getItem('tg-drive-no-sw-reload') === '1';
  } catch {
    return false;
  }
}

/** Persist timeline / logs when explicitly debugging (not during normal mobile use). */
export function shouldPersistDebugTelemetry() {
  return isAppDebugEnabled() || isDebugPanelForced() || isNoSwReloadEnabled();
}

export function isDebugPanelForced() {
  try {
    if (typeof window !== 'undefined') {
      if (new URLSearchParams(window.location.search).get('debugReload') === '1') {
        localStorage.setItem('tg-drive-debug-panel', '1');
        return true;
      }
    }
    return localStorage.getItem('tg-drive-debug-panel') === '1';
  } catch {
    return false;
  }
}

export function recordDebugEvent(type, detail = {}) {
  if (typeof window === 'undefined' || !shouldPersistDebugTelemetry()) return;
  try {
    const events = safeParse(localStorage.getItem(DEBUG_EVENTS_KEY), []);
    events.push({
      t: new Date().toISOString(),
      type,
      detail: {
        ...detail,
        href: window.location.href,
        nav: navigationType(),
        reloadCount: sessionStorage.getItem('stream-sw-reload-attempted'),
      },
    });
    while (events.length > MAX_EVENTS) {
      events.shift();
    }
    localStorage.setItem(DEBUG_EVENTS_KEY, JSON.stringify(events));
  } catch {
    /* ignore quota / private mode */
  }
}

export function appendPersistedLog(line) {
  if (typeof window === 'undefined' || !isAppDebugEnabled()) return;
  try {
    const logs = safeParse(localStorage.getItem(DEBUG_LOGS_KEY), []);
    logs.push({ t: new Date().toISOString(), line });
    while (logs.length > MAX_LOG_LINES) {
      logs.shift();
    }
    localStorage.setItem(DEBUG_LOGS_KEY, JSON.stringify(logs));
  } catch {
    /* ignore */
  }
}

export async function collectServiceWorkerSnapshot() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return { supported: false };
  }
  const snap = {
    supported: true,
    controller: !!navigator.serviceWorker.controller,
    controllerScriptURL: navigator.serviceWorker.controller?.scriptURL || null,
  };
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    snap.registrations = await Promise.all(
      regs.map(async (reg) => ({
        scope: reg.scope,
        active: reg.active?.state,
        activeUrl: reg.active?.scriptURL,
        waiting: reg.waiting?.state,
        installing: reg.installing?.state,
      })),
    );
  } catch (error) {
    snap.registrationError = error?.message || String(error);
  }
  return snap;
}

export async function buildDebugReport() {
  const events = safeParse(localStorage.getItem(DEBUG_EVENTS_KEY), []);
  const logs = safeParse(localStorage.getItem(DEBUG_LOGS_KEY), []);
  const memLogs = typeof window !== 'undefined' ? window.__STREAM_DEBUG_LOGS || [] : [];

  const sw = await collectServiceWorkerSnapshot();

  const report = {
    generatedAt: new Date().toISOString(),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewport:
      typeof window !== 'undefined'
        ? { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio }
        : null,
    location: typeof window !== 'undefined' ? window.location.href : '',
    noSwReload: isNoSwReloadEnabled(),
    sessionReloadCount: (() => {
      try {
        return sessionStorage.getItem('stream-sw-reload-attempted');
      } catch {
        return null;
      }
    })(),
    serviceWorker: sw,
    eventTimeline: events,
    persistedLogs: logs,
    inMemoryStreamLogs: memLogs.slice(-80),
  };

  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function copyDebugReport() {
  const text = await buildDebugReport();
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true, text, via: 'clipboard' };
    } catch {
      /* fall through */
    }
  }
  return { ok: false, text, via: 'manual' };
}

export function clearDebugPersistence() {
  try {
    localStorage.removeItem(DEBUG_EVENTS_KEY);
    localStorage.removeItem(DEBUG_LOGS_KEY);
    sessionStorage.removeItem('stream-sw-reload-attempted');
    localStorage.removeItem('tg-drive-no-sw-reload');
  } catch {
    /* ignore */
  }
}

/** First React tick — record that the app bundle started. */
export function recordAppBoot() {
  if (!shouldPersistDebugTelemetry()) {
    return;
  }
  recordDebugEvent('react_boot', {
    hasSwController: !!navigator.serviceWorker?.controller,
    noSwReload: isNoSwReloadEnabled(),
  });
}