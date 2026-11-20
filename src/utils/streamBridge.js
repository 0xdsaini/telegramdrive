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

  if (registrationRef?.waiting) {
    registrationRef.waiting.postMessage({ type: 'SKIP_WAITING' });
  }
  if (registrationRef?.installing) {
    streamDebug('bridge', 'SW still installing', { state: registrationRef.installing.state });
  }
  await registrationRef?.update?.();

  const acquired = await new Promise((resolve) => {
    if (navigator.serviceWorker.controller) {
      resolve(true);
      return;
    }

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

  if (acquired) {
    streamDebug('bridge', 'service worker now controlling page');
    sessionStorage.removeItem('stream-sw-reload-attempted');
    return;
  }

  if (!sessionStorage.getItem('stream-sw-reload-attempted')) {
    sessionStorage.setItem('stream-sw-reload-attempted', '1');
    streamDebug('bridge', 'no controller — reloading once to activate stream SW');
    window.location.reload();
    await new Promise(() => {});
  }

  throw new Error(
    'Stream service worker is not active. Hard refresh this tab (Cmd+Shift+R), then try Play again.'
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

  await withFilePartQueue(fileId, async () => {
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