import { getAppBasePath, redirectToAppBaseIfNeeded } from './appBasePath';
import {
  requestTdlibFilePart,
  cancelTdlibFilePartRequests,
  cancelTdlibFileDownloads,
  prioritizeStreamingDownloads,
} from './tdlibFilePartReader';
import { syncStreamSwDebugFlag } from './appDebug';
import { streamDebug, streamDebugError } from './streamDebug';
import { isNoSwReloadEnabled, recordDebugEvent } from './reloadDebug';

let registered = false;
let activeClient = null;
let registrationRef = null;
const STREAM_SW_REV = 9;
const partRequestChains = new Map();
/** Avoid back-to-back full prepare (Play click + modal open both used to call this). */
const PREPARE_RECENT_MS = 45_000;
let lastPrepareAt = 0;
let lastPrepareController = false;
let reclaimInFlight = null;

let playbackModalOpen = false;
const playbackFileIds = new Set();
const playbackIdleListeners = new Set();

export function setPlaybackModalOpen(open) {
  const wasOpen = playbackModalOpen;
  playbackModalOpen = !!open;
  if (wasOpen && !playbackModalOpen) {
    playbackIdleListeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
  }
}

export function registerPlaybackFileId(fileId) {
  if (fileId != null && fileId !== '') {
    playbackFileIds.add(String(fileId));
  }
}

export function unregisterPlaybackFileId(fileId) {
  if (fileId != null && fileId !== '') {
    playbackFileIds.delete(String(fileId));
  }
}

export function isPosterBackfillAllowed(fileId) {
  if (playbackModalOpen) {
    return false;
  }
  if (fileId != null && playbackFileIds.has(String(fileId))) {
    return false;
  }
  return true;
}

export function subscribePlaybackIdle(listener) {
  playbackIdleListeners.add(listener);
  return () => playbackIdleListeners.delete(listener);
}

function withFilePartQueue(fileId, task) {
  const prev = partRequestChains.get(fileId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(task);
  partRequestChains.set(fileId, run);
  return run.finally(() => {
    if (partRequestChains.get(fileId) === run) {
      partRequestChains.delete(fileId);
    }
  });
}

function getScope() {
  const base = getAppBasePath();
  return base ? `${base}/` : '/';
}

function postToController(message) {
  const controller = navigator.serviceWorker?.controller;
  if (controller) {
    controller.postMessage(message);
  }
}

export function isStreamServiceWorkerControlling() {
  return !!navigator.serviceWorker?.controller;
}

const STREAM_SW_RELOAD_KEY = 'stream-sw-reload-attempted';
const STREAM_SW_MAX_RELOADS = 2;

function getStreamSwReloadCount() {
  try {
    const raw = sessionStorage.getItem(STREAM_SW_RELOAD_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
    return raw === '1' ? 1 : 0;
  } catch {
    return 0;
  }
}

function incrementStreamSwReloadCount() {
  try {
    sessionStorage.setItem(STREAM_SW_RELOAD_KEY, String(getStreamSwReloadCount() + 1));
  } catch {
    /* ignore */
  }
}

function clearStreamSwReloadFlag() {
  try {
    sessionStorage.removeItem(STREAM_SW_RELOAD_KEY);
  } catch {
    /* ignore */
  }
}

async function promoteWaitingServiceWorker(registration) {
  if (!registration) return;
  const worker = registration.waiting || registration.installing;
  if (worker) {
    worker.postMessage({ type: 'SKIP_WAITING' });
    streamDebug('bridge', 'SKIP_WAITING posted', { state: worker.state });
  }
  await registration.update?.();
}

function postToRegistrationWorker(registration, message) {
  const worker = registration?.active || registration?.waiting || registration?.installing;
  if (worker) {
    worker.postMessage(message);
  }
  const controller = navigator.serviceWorker?.controller;
  if (controller) {
    controller.postMessage(message);
  }
}

/** Active SW often exists while this document has no controller — claim without unregister. */
async function requestForceClaim(registration) {
  postToRegistrationWorker(registration, { type: 'FORCE_CLAIM' });
  postToRegistrationWorker(registration, { type: 'SKIP_WAITING' });
  await waitForControllerOnly(2500);
}

/** @returns {boolean} whether a reload was started */
function reloadForServiceWorkerControl(source = 'streamBridge:unspecified') {
  const count = getStreamSwReloadCount();
  const sw = {
    hasController: !!navigator.serviceWorker?.controller,
    active: registrationRef?.active?.state,
    waiting: registrationRef?.waiting?.state,
    installing: registrationRef?.installing?.state,
  };

  if (isNoSwReloadEnabled()) {
    streamDebug('bridge', 'reload BLOCKED (noSwReload)', { source, count, sw });
    recordDebugEvent('reload_blocked', { source, count, sw, reason: 'noSwReload' });
    return false;
  }

  if (count >= STREAM_SW_MAX_RELOADS) {
    streamDebug('bridge', 'reloadForServiceWorkerControl skipped (max reloads)', { source, count, sw });
    recordDebugEvent('reload_skipped_max', { source, count, sw });
    return false;
  }

  incrementStreamSwReloadCount();
  const nextCount = getStreamSwReloadCount();
  streamDebug('bridge', 'reloadForServiceWorkerControl', { source, count: nextCount, sw });
  recordDebugEvent('reload_scheduled', { source, count: nextCount, sw });
  window.location.reload();
  return true;
}

/** Poll until this document has an active controller (no reload side effects). */
async function waitForControllerOnly(timeoutMs = 8000) {
  if (navigator.serviceWorker?.controller) {
    return true;
  }

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (ok) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearInterval(poll);
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      resolve(ok);
    };

    const onChange = () => finish(!!navigator.serviceWorker.controller);
    const timer = setTimeout(() => finish(!!navigator.serviceWorker.controller), timeoutMs);
    const poll = setInterval(() => {
      if (navigator.serviceWorker.controller) finish(true);
    }, 150);

    navigator.serviceWorker.addEventListener('controllerchange', onChange);
  });
}

/**
 * Unregister and register again — fixes stale tabs where reload no longer acquires control.
 */
export async function reclaimStreamServiceWorker({ hard = false } = {}) {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this browser.');
  }

  if (reclaimInFlight) {
    return reclaimInFlight;
  }

  reclaimInFlight = (async () => {
    clearStreamSwReloadFlag();
    lastPrepareAt = 0;
    lastPrepareController = false;

    await ensureStreamBridgeRegistered();

    if (!hard && navigator.serviceWorker?.controller) {
      streamDebug('bridge', 'reclaimStreamServiceWorker: already controlling');
      return;
    }

    streamDebug('bridge', 'reclaimStreamServiceWorker', {
      hard,
      hadController: !!navigator.serviceWorker?.controller,
    });

    await promoteWaitingServiceWorker(registrationRef);
    await requestForceClaim(registrationRef);
    if (navigator.serviceWorker?.controller) {
      streamDebug('bridge', 'reclaim: FORCE_CLAIM ok');
      return;
    }

    if (!hard) {
      return;
    }

    const scope = getScope();
    const base = getAppBasePath();
    const swUrl = `${base}/progressive-sw.js?rev=${STREAM_SW_REV}`;
    const existing = registrationRef || (await navigator.serviceWorker.getRegistration(scope));

    if (existing) {
      await existing.unregister();
      streamDebug('bridge', 'reclaim: unregistered prior SW');
    }

    registrationRef = await navigator.serviceWorker.register(swUrl, {
      scope,
      updateViaCache: 'none',
    });
    await navigator.serviceWorker.ready;
    await promoteWaitingServiceWorker(registrationRef);
    await requestForceClaim(registrationRef);

    if (navigator.serviceWorker?.controller) {
      streamDebug('bridge', 'reclaimStreamServiceWorker OK');
      return;
    }

    if (registrationRef?.active) {
      streamDebug('bridge', 'reclaim: active SW, still no controller — reloading');
      reloadForServiceWorkerControl('reclaimStreamServiceWorker:active-still-no-controller');
      await new Promise(() => {});
    }

    throw new Error(
      'Could not activate the stream worker in this tab. Open this app in a new browser tab, or run resetStreamServiceWorker() in the console.'
    );
  })();

  try {
    await reclaimInFlight;
  } finally {
    reclaimInFlight = null;
  }
}

/**
 * Streaming only works when progressive-sw.js intercepts /stream/ fetches.
 */
export async function waitForStreamServiceWorkerControl({ timeoutMs = 8000, allowReload = true } = {}) {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this browser.');
  }

  if (redirectToAppBaseIfNeeded()) {
    throw new Error('Redirecting to app URL with correct path for streaming…');
  }

  await ensureStreamBridgeRegistered();

  if (navigator.serviceWorker.controller) {
    streamDebug('bridge', 'waitForStreamServiceWorkerControl: already controlling');
    return;
  }

  streamDebug('bridge', 'waitForStreamServiceWorkerControl: waiting for controller…', { timeoutMs });

  await promoteWaitingServiceWorker(registrationRef);
  if (registrationRef?.installing) {
    streamDebug('bridge', 'SW still installing', { state: registrationRef.installing.state });
  }

  await requestForceClaim(registrationRef);

  const acquired = await waitForControllerOnly(Math.min(timeoutMs, 2500));

  if (acquired) {
    streamDebug('bridge', 'service worker now controlling page');
    clearStreamSwReloadFlag();
    return;
  }

  await reclaimStreamServiceWorker({ hard: false });
  const acquiredAfterClaim = await waitForControllerOnly(2000);
  if (acquiredAfterClaim) {
    streamDebug('bridge', 'service worker controlling page after soft reclaim');
    clearStreamSwReloadFlag();
    return;
  }

  if (!allowReload) {
    throw new Error('Stream worker is not attached to this tab yet.');
  }

  const scopeHint = getAppBasePath();
  throw new Error(
    scopeHint
      ? `Streaming needs the URL path ${scopeHint}/ (note the trailing slash). Refresh or open that link, then press Play again.`
      : 'Stream worker is not attached to this tab. Refresh the page and try Play again.'
  );
}

export function toggleStreamInUse(url, inUse) {
  streamDebug('bridge', 'toggleStreamInUse', { inUse, url: url?.slice(0, 120) });
  const controller = navigator.serviceWorker?.controller;
  if (!controller) {
    streamDebugError('bridge', 'toggleStreamInUse: no service worker controller', new Error('no-controller'));
    return;
  }
  postToController({ type: 'toggleStreamInUse', url, inUse });
}

async function handleStreamRequest(event) {
  const { payload } = event.data;
  const port = event.ports?.[0];

  streamDebug('bridge', 'STREAM_REQUEST_PART received', payload);

  if (!port) {
    streamDebugError('bridge', 'STREAM_REQUEST_PART missing MessagePort', event.data);
    return;
  }
  if (!payload) {
    port.postMessage({ error: 'Missing payload' });
    return;
  }
  if (!activeClient) {
    streamDebugError('bridge', 'STREAM_REQUEST_PART: TDLib client not set', payload);
    port.postMessage({ error: 'TDLib client not ready' });
    return;
  }

  const { fileId, size, offset, limit, fromPreload } = payload;
  const t0 = performance.now();

  withFilePartQueue(fileId, async () => {
    try {
      const bytes = await requestTdlibFilePart(activeClient, fileId, size, offset, limit, {
        fromPreload: !!fromPreload,
      });
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      streamDebug('bridge', 'STREAM_REQUEST_PART OK', {
        fileId,
        offset,
        limit,
        byteLength: buffer.byteLength,
        ms: Math.round(performance.now() - t0),
      });
      port.postMessage({ bytes: buffer }, [buffer]);
    } catch (error) {
      streamDebugError('bridge', 'STREAM_REQUEST_PART failed', error);
      port.postMessage({ error: error.message || String(error) });
    }
  });
}

export function setStreamBridgeClient(telegramClient) {
  activeClient = telegramClient;
  streamDebug('bridge', 'setStreamBridgeClient', { ready: !!telegramClient });
}

async function assertTdlibResponsive(client, timeoutMs = 10_000) {
  if (!client?.send) {
    throw new Error('Telegram client is not ready. Refresh the page and try again.');
  }
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Telegram connection timed out. Refresh the page and try again.')), timeoutMs);
  });
  try {
    await Promise.race([client.send({ '@type': 'getNetworkStatistics' }), timeout]);
  } catch (error) {
    const msg = error?.message || String(error);
    if (/timed out|not ready/i.test(msg)) {
      throw error instanceof Error ? error : new Error(msg);
    }
    streamDebug('bridge', 'getNetworkStatistics probe failed (continuing)', { msg });
  }
}

/**
 * Re-claim the stream service worker and verify TDLib before playback (idle tabs often lose SW control).
 */
export async function prepareForStreaming(
  telegramClient,
  { timeoutMs = 15_000, force = false, allowReload = true } = {},
) {
  if (telegramClient) {
    setStreamBridgeClient(telegramClient);
  }

  const hasController = !!navigator.serviceWorker?.controller;
  if (
    !force
    && hasController
    && lastPrepareController
    && Date.now() - lastPrepareAt < PREPARE_RECENT_MS
    && activeClient === telegramClient
  ) {
    streamDebug('bridge', 'prepareForStreaming: recent prepare still valid');
    return;
  }

  recordDebugEvent('prepare_for_streaming', {
    force,
    allowReload,
    hasController: !!navigator.serviceWorker?.controller,
  });

  await ensureStreamBridgeRegistered();
  await waitForStreamServiceWorkerControl({ timeoutMs, allowReload });

  if (!navigator.serviceWorker?.controller) {
    lastPrepareAt = 0;
    lastPrepareController = false;
    throw new Error(
      'Stream worker could not be activated in this tab. Open the app in a new tab, or run resetStreamServiceWorker() in the console.'
    );
  }

  if (telegramClient) {
    await assertTdlibResponsive(telegramClient, 8_000);
  }

  lastPrepareAt = Date.now();
  lastPrepareController = !!navigator.serviceWorker?.controller;
}

export async function refreshStreamBridgeAfterIdle(telegramClient, { idleMs = 0 } = {}) {
  try {
    streamDebug('bridge', 'refreshStreamBridgeAfterIdle', { idleMs });
    lastPrepareAt = 0;
    lastPrepareController = false;
    clearStreamSwReloadFlag();

    if (telegramClient) {
      setStreamBridgeClient(telegramClient);
    }

    if (!navigator.serviceWorker?.controller) {
      // Never unregister on focus/visibility — that guarantees this tab stays uncontrolled until reload.
      await reclaimStreamServiceWorker({ hard: false });
      await waitForControllerOnly(idleMs > 0 ? 6000 : 4000);
      return;
    }

    if (idleMs >= 5 * 60_000) {
      await ensureStreamBridgeRegistered();
      await promoteWaitingServiceWorker(registrationRef);
      await requestForceClaim(registrationRef);
      await waitForControllerOnly(4000);
    }
  } catch (error) {
    streamDebugError('bridge', 'refreshStreamBridgeAfterIdle', error);
  }
}

async function ensureStreamBridgeRegistered() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  redirectToAppBaseIfNeeded();

  const base = getAppBasePath();
  const swUrl = `${base}/progressive-sw.js?rev=${STREAM_SW_REV}`;
  const scope = getScope();

  if (!registered) {
    registered = true;
    streamDebug('bridge', 'registerStreamBridge start', { swUrl, scope });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SKIP_WAITING') return;
      if (event.data?.type === 'STREAM_REQUEST_PART') {
        handleStreamRequest(event);
      }
      if (event.data?.type === 'STREAM_PRIORITIZE') {
        streamDebug('bridge', 'STREAM_PRIORITIZE (noop)', { fileId: event.data.fileId });
        prioritizeStreamingDownloads(activeClient, event.data.fileId);
      }
      if (event.data?.type === 'STREAM_CANCEL_PARTS') {
        streamDebug('bridge', 'STREAM_CANCEL_PARTS', { fileId: event.data.fileId });
        cancelTdlibFileDownloads(activeClient, event.data.fileId);
      }
      if (event.data?.type === 'STREAM_DEBUG_RELAY') {
        streamDebug(`sw:${event.data.stage}`, event.data.msg, event.data.extra);
      }
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      streamDebug('bridge', 'controllerchange', {
        hasController: !!navigator.serviceWorker.controller,
      });
    });

    try {
      registrationRef = await navigator.serviceWorker.register(swUrl, {
        scope,
        updateViaCache: 'none',
      });
      await navigator.serviceWorker.ready;
      syncStreamSwDebugFlag();
      streamDebug('bridge', 'registerStreamBridge OK', {
        scope: registrationRef.scope,
        active: registrationRef.active?.scriptURL,
        waiting: registrationRef.waiting?.scriptURL,
        hasController: !!navigator.serviceWorker.controller,
      });
      if (!navigator.serviceWorker.controller) {
        await requestForceClaim(registrationRef);
      }
    } catch (error) {
      streamDebugError('bridge', 'Service worker registration failed', error);
      recordDebugEvent('sw_register_failed', {
        swUrl,
        scope,
        base: getAppBasePath(),
        message: error?.message || String(error),
      });
      throw error;
    }
  } else if (!registrationRef) {
    registrationRef = await navigator.serviceWorker.getRegistration(scope);
  }
}

export async function registerStreamBridge() {
  try {
    await ensureStreamBridgeRegistered();
    await requestForceClaim(registrationRef);
    const controlling = await waitForControllerOnly(10_000);
    streamDebug('bridge', 'registerStreamBridge boot', { controlling });
  } catch (error) {
    streamDebugError('bridge', 'registerStreamBridge', error);
  }
}