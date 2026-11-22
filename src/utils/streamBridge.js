import { getAppBasePath } from './appBasePath';
import { requestMtprotoFilePart, cancelMtprotoFilePartRequests } from '../mtproto/requestFilePartMtproto';
import { streamDebug, streamDebugError } from './streamDebug';

let registered = false;
let activeClient = null;
let registrationRef = null;
const STREAM_SW_REV = 11;
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
  if (!activeClient?._gram) {
    streamDebugError('bridge', 'STREAM_REQUEST_PART: MTProto client not set', payload);
    port.postMessage({ error: 'Telegram client not ready' });
    return;
  }

  const { fileId, size, offset, limit, messageId, chatId } = payload;
  const t0 = performance.now();
  const gram = activeClient._gram;

  // Web A handles each SW range independently; do not serialize unrelated offsets.
  (async () => {
    try {
      const bytes = await requestMtprotoFilePart(gram, fileId, size, offset, limit, {
        messageId,
        chatId,
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
  })();
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

export function isStreamingReadyForPlayback() {
  return !!navigator.serviceWorker?.controller && !!activeClient;
}

/**
 * Re-claim the stream service worker and verify TDLib before playback (idle tabs often lose SW control).
 */
export async function prepareForStreaming(telegramClient, { timeoutMs = 15_000, skipTdlibProbe = false } = {}) {
  if (telegramClient) {
    setStreamBridgeClient(telegramClient);
  }
  await ensureStreamBridgeRegistered();

  if (navigator.serviceWorker?.controller) {
    streamDebug('bridge', 'prepareForStreaming: service worker already controlling');
    if (telegramClient && !skipTdlibProbe) {
      await assertTdlibResponsive(telegramClient, 5_000);
    }
    return;
  }

  await waitForStreamServiceWorkerControl({ timeoutMs });

  if (!navigator.serviceWorker?.controller) {
    throw new Error(
      'Stream service worker is not controlling this tab. Hard-refresh (Cmd+Shift+R), then play again.'
    );
  }

  if (telegramClient && !skipTdlibProbe) {
    await assertTdlibResponsive(telegramClient);
  }
}

export async function refreshStreamBridgeAfterIdle(telegramClient) {
  try {
    streamDebug('bridge', 'refreshStreamBridgeAfterIdle');
    await ensureStreamBridgeRegistered();
    if (registrationRef?.waiting) {
      registrationRef.waiting.postMessage({ type: 'SKIP_WAITING' });
    }
    await registrationRef?.update?.();
    await waitForStreamServiceWorkerControl({ timeoutMs: 5000 });
    if (telegramClient) {
      setStreamBridgeClient(telegramClient);
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
      if (event.data?.type === 'STREAM_CANCEL_PARTS') {
        streamDebug('bridge', 'STREAM_CANCEL_PARTS', { fileId: event.data.fileId });
        cancelMtprotoFilePartRequests(event.data.fileId);
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