import { getAppBasePath } from './appBasePath';
import {
  requestTdlibFilePart,
  cancelTdlibFilePartRequests,
  cancelTdlibFileDownloads,
  prioritizeStreamingDownloads,
} from './tdlibFilePartReader';
import { streamDebug, streamDebugError } from './streamDebug';

let registered = false;
let activeClient = null;
let registrationRef = null;
const STREAM_SW_REV = 7;
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

function reloadForServiceWorkerControl() {
  streamDebug('bridge', 'reloadForServiceWorkerControl');
  clearStreamSwReloadFlag();
  sessionStorage.removeItem('stream-sw-early-claim');
  window.location.reload();
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
      reloadForServiceWorkerControl();
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
export async function waitForStreamServiceWorkerControl({ timeoutMs = 8000 } = {}) {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this browser.');
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

  const acquired = await waitForControllerOnly(Math.min(timeoutMs, 5000));

  if (acquired) {
    streamDebug('bridge', 'service worker now controlling page');
    clearStreamSwReloadFlag();
    return;
  }

  if (registrationRef?.active) {
    streamDebug('bridge', 'active SW without controller — reload to attach');
    reloadForServiceWorkerControl();
    throw new Error('Reloading to attach stream worker… press Play again right after the page loads.');
  }

  if (!sessionStorage.getItem(STREAM_SW_RELOAD_KEY)) {
    sessionStorage.setItem(STREAM_SW_RELOAD_KEY, '1');
    streamDebug('bridge', 'no active SW — reloading once');
    reloadForServiceWorkerControl();
    throw new Error(
      'Activating stream worker — reloading this tab once. After the reload, press Play again.'
    );
  }

  streamDebug('bridge', 'prior reload did not help — hard reclaim');
  await reclaimStreamServiceWorker({ hard: true });

  if (!navigator.serviceWorker?.controller) {
    throw new Error(
      'Stream worker is not attached to this tab. Press Play once more, or open the app in a new tab.'
    );
  }
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
export async function prepareForStreaming(telegramClient, { timeoutMs = 15_000, force = false } = {}) {
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

  await ensureStreamBridgeRegistered();
  await waitForStreamServiceWorkerControl({ timeoutMs });

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

    const needsHardReclaim =
      !navigator.serviceWorker?.controller || idleMs >= 5 * 60_000;

    if (needsHardReclaim) {
      await reclaimStreamServiceWorker({ hard: !navigator.serviceWorker?.controller });
    } else {
      await ensureStreamBridgeRegistered();
      await promoteWaitingServiceWorker(registrationRef);
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
      throw error;
    }
  } else if (!registrationRef) {
    registrationRef = await navigator.serviceWorker.getRegistration(scope);
  }
}

export async function registerStreamBridge() {
  try {
    await ensureStreamBridgeRegistered();
    await waitForStreamServiceWorkerControl({ timeoutMs: 3000 });
  } catch (error) {
    streamDebugError('bridge', 'registerStreamBridge', error);
  }
}