/* eslint-disable no-restricted-globals */
/**
 * Telegram Web K–style media streaming (service worker + HTTP Range).
 * File bytes are fetched from the page via TDLib (downloadFile + readFilePart).
 * STREAM_SW_REV=6 — TDLib: sequential 1 MiB parts (no single 2 MiB downloadFile).
 */
const STREAM_SW_REV = 7;

const STREAM_CHUNK_MIDDLE_LIMIT = 512 * 1024;
const STREAM_CHUNK_UPPER_LIMIT = 1024 * 1024;
const SMALLEST_CHUNK_LIMIT = 4 * 1024;
const PRELOAD_SIZE = 20 * 1024 * 1024;
const PRELOAD_SIZE_TDLIB = 0;
const CACHE_NAME = 'cachedStreamChunks-v1';
const CACHE_URL_PREFIX = 'https://stream-cache.local/';

const STREAMABLE_MIME_TYPE = /^(?:video|audio|image)\/[\w.+-]+$/;

const deferredPromises = new Map();
const streams = new Map();

function swDebug(stage, msg, extra) {
  console.log('[STREAM_DEBUG_SW]', stage, msg, extra || '');
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach((client) => {
      client.postMessage({ type: 'STREAM_DEBUG_RELAY', stage, msg, extra });
    });
  });
}

function safeContentType(mimeType) {
  return STREAMABLE_MIME_TYPE.test(mimeType) ? mimeType : 'application/octet-stream';
}

function parseRange(header) {
  if (!header) return [0, 0];
  const [, chunks] = header.split('=');
  const ranges = chunks.split(', ');
  const [offset, end] = ranges[0].split('-');
  return [+offset, +end || 0];
}

function alignOffset(offset, base = SMALLEST_CHUNK_LIMIT) {
  return offset - (offset % base);
}

function alignLimit(limit) {
  return limit <= 1 ? 1 : 2 ** (32 - Math.clz32(limit - 1));
}

function bufferConcats(...parts) {
  const filtered = parts.filter(Boolean);
  const total = filtered.reduce((acc, p) => acc + p.byteLength, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const part of filtered) {
    out.set(part, pos);
    pos += part.byteLength;
  }
  return out;
}

function parseInfo(params) {
  return JSON.parse(decodeURIComponent(params));
}

function getStreamId(info) {
  return String(info.fileId);
}

function responseForSafariFirstRange(range, mimeType, size) {
  if (range[0] === 0 && range[1] === 1) {
    return new Response(new Uint8Array(2).buffer, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes 0-1/${size || '*'}`,
        'Content-Length': '2',
        'Content-Type': mimeType || 'video/mp4',
      },
    });
  }
  return null;
}

async function openCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

function pickPageClient(clients, preferredClientId) {
  if (!clients?.length) return null;
  if (preferredClientId) {
    const match = clients.find((c) => c.id === preferredClientId);
    if (match) return match;
  }
  return clients.find((c) => c.focused) ?? clients[clients.length - 1];
}

async function requestFilePartFromPage(info, alignedOffset, limit, fromPreload = false, preferredClientId) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  swDebug('page-part', 'clients', {
    count: clients.length,
    ids: clients.map((c) => c.id),
    preferredClientId,
  });
  const client = pickPageClient(clients, preferredClientId);
  if (!client) {
    swDebug('page-part', 'FAIL no window client', { alignedOffset, limit });
    throw new Error('No active window client for streaming');
  }

  const payload = {
    fileId: info.fileId,
    size: info.size,
    offset: alignedOffset,
    limit,
    fromPreload: !!fromPreload,
    priority: fromPreload ? 'preload' : 'foreground',
  };
  const taskId = JSON.stringify(payload);

  let promises = deferredPromises.get(client.id);
  if (!promises) {
    deferredPromises.set(client.id, (promises = {}));
  }

  let existing = promises[taskId];
  if (existing) {
    return existing;
  }

  const deferred = new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeoutMs = Math.min(300_000, 60_000 + Math.floor((limit / (512 * 1024)) * 30_000));
    const timer = setTimeout(() => reject(new Error('STREAM_REQUEST_PART timeout')), timeoutMs);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      if (event.data?.error) {
        swDebug('page-part', 'page returned error', event.data.error);
        reject(new Error(event.data.error));
        return;
      }
      const len = event.data?.bytes?.byteLength ?? 0;
      swDebug('page-part', 'page returned bytes', { alignedOffset, limit, byteLength: len });
      resolve(new Uint8Array(event.data.bytes));
    };
    swDebug('page-part', 'postMessage STREAM_REQUEST_PART', payload);
    client.postMessage(
      { type: 'STREAM_REQUEST_PART', payload },
      [channel.port2]
    );
  });

  promises[taskId] = deferred;
  deferred.finally(() => {
    if (promises[taskId] === deferred) {
      delete promises[taskId];
      if (!Object.keys(promises).length) {
        deferredPromises.delete(client.id);
      }
    }
  });

  return deferred;
}

class Stream {
  constructor(info, preferredClientId) {
    this.info = info;
    this.preferredClientId = preferredClientId || null;
    this.id = getStreamId(info);
    this.limitPart =
      info.size > 75 * 1024 * 1024 ? STREAM_CHUNK_UPPER_LIMIT : STREAM_CHUNK_MIDDLE_LIMIT;
    this.loadedOffsets = new Set();
    this.inUse = 0;
    this.destroyTimer = null;
    streams.set(this.id, this);
  }

  scheduleDestroy() {
    clearTimeout(this.destroyTimer);
    this.destroyTimer = setTimeout(() => this.destroy(), 150_000);
  }

  destroy() {
    if (this.inUse > 0) {
      this.scheduleDestroy();
      return;
    }
    clearTimeout(this.destroyTimer);
    streams.delete(this.id);
    const clients = self.clients.matchAll({ type: 'window' });
    clients.then((list) => {
      list.forEach((client) => {
        client.postMessage({ type: 'STREAM_CANCEL_PARTS', fileId: this.info.fileId });
      });
    });
  }

  toggleInUse(inUse) {
    this.inUse = Math.max(0, this.inUse + (inUse ? 1 : -1));
    if (!this.inUse) {
      this.destroy();
    }
  }

  getChunkKey(alignedOffset, limit) {
    return `${this.id}?offset=${alignedOffset}&limit=${limit}`;
  }

  cacheRequestForKey(key) {
    return new Request(CACHE_URL_PREFIX + key);
  }

  async requestFilePartFromCache(alignedOffset, limit) {
    const cache = await openCache();
    if (!cache) return null;
    const key = this.getChunkKey(alignedOffset, limit);
    const match = await cache.match(this.cacheRequestForKey(key));
    if (!match) return null;
    return new Uint8Array(await match.arrayBuffer());
  }

  async saveChunkToCache(bytesPromise, alignedOffset, limit) {
    const cache = await openCache();
    if (!cache) return;
    try {
      const bytes = await bytesPromise;
      const key = this.getChunkKey(alignedOffset, limit);
      await cache.put(
        this.cacheRequestForKey(key),
        new Response(bytes, {
          headers: { 'Content-Type': 'application/octet-stream' },
        })
      );
    } catch {
      /* best-effort */
    }
  }

  usesTdlib() {
    return this.info.backend !== 'mtproto';
  }

  preloadSize() {
    return this.usesTdlib() ? PRELOAD_SIZE_TDLIB : PRELOAD_SIZE;
  }

  async requestFilePart(alignedOffset, limit, fromPreload = false) {
    const cached = await this.requestFilePartFromCache(alignedOffset, limit);
    if (cached) {
      return cached;
    }

    if (this.usesTdlib() && fromPreload) {
      return new Uint8Array(0);
    }

    if (this.loadedOffsets.has(alignedOffset) && fromPreload) {
      return new Uint8Array(0);
    }
    this.loadedOffsets.add(alignedOffset);

    const payloadLimit = limit;
    const bytesPromise = requestFilePartFromPage(
      this.info,
      alignedOffset,
      payloadLimit,
      fromPreload,
      this.preferredClientId
    );
    this.saveChunkToCache(bytesPromise, alignedOffset, limit);

    if (!fromPreload && this.preloadSize() > 0) {
      this.preloadChunks(alignedOffset, this.preloadSize());
    }

    return bytesPromise;
  }

  preloadChunk(offset) {
    if (this.preloadSize() <= 0) return;
    if (this.loadedOffsets.has(offset)) return;
    this.loadedOffsets.add(offset);
    this.requestFilePart(offset, this.limitPart, true).catch(() => {});
  }

  preloadChunks(from, size) {
    if (size <= 0) return;
    if (!from) {
      if (this.info.size) {
        this.preloadChunk(alignOffset(this.info.size - 1, this.limitPart));
      }
      return;
    }

    let offset = alignOffset(from, this.limitPart);
    let end = offset + size;
    if (end > this.info.size) {
      end = this.info.size;
    }
    for (; offset < end; offset += this.limitPart) {
      this.preloadChunk(offset);
    }
  }

  async requestRange(range) {
    this.scheduleDestroy();
    swDebug('range', 'requestRange', {
      fileId: this.info.fileId,
      range,
      size: this.info.size,
      mimeType: this.info.mimeType,
    });

    const safari = responseForSafariFirstRange(range, this.info.mimeType, this.info.size);
    if (safari) {
      swDebug('range', 'safari first range stub', range);
      return safari;
    }

    let [offset, end] = range;

    const limit =
      end && end < this.limitPart
        ? Math.max(SMALLEST_CHUNK_LIMIT, alignLimit(end - offset + 1))
        : this.limitPart;
    const alignedOffset = alignOffset(offset, limit);

    if (!end) {
      end = Math.min(offset + limit, this.info.size - 1);
    }

    let overflow;
    if (offset !== alignedOffset || end !== alignedOffset + limit) {
      overflow = end - alignedOffset - limit + 1;
    }

    const needsSecondChunk = overflow && overflow > 0;

    swDebug('range', 'fetchPlan', {
      fileId: this.info.fileId,
      offset,
      end,
      alignedOffset,
      limit,
      needsSecondChunk: !!needsSecondChunk,
      tdlib: this.usesTdlib(),
      rev: STREAM_SW_REV,
    });

    let ab;
    if (this.usesTdlib() && needsSecondChunk) {
      const p1 = await this.requestFilePart(alignedOffset, limit);
      const p2 = await this.requestFilePart(alignedOffset + limit, limit);
      ab = bufferConcats(p1, p2);
    } else {
      ab = await this.requestFilePart(alignedOffset, limit);
    }

    if (offset !== alignedOffset || end !== alignedOffset + limit) {
      const sliceStart = offset - alignedOffset;
      const sliceEnd = end - alignedOffset + 1;
      ab = ab.subarray(sliceStart, sliceEnd);
    }

    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${offset}-${offset + ab.byteLength - 1}/${this.info.size || '*'}`,
      'Content-Length': `${ab.byteLength}`,
    };

    if (this.info.mimeType) {
      headers['Content-Type'] = safeContentType(this.info.mimeType);
      headers['X-Content-Type-Options'] = 'nosniff';
    }

    swDebug('range', '206 response', {
      offset,
      end,
      bodyBytes: ab.byteLength,
      contentRange: headers['Content-Range'],
    });

    return new Response(ab, {
      status: 206,
      statusText: 'Partial Content',
      headers,
    });
  }

  static get(info, preferredClientId) {
    const id = getStreamId(info);
    const existing = streams.get(id);
    if (existing) {
      if (preferredClientId) {
        existing.preferredClientId = preferredClientId;
      }
      return existing;
    }
    return new Stream(info, preferredClientId);
  }

  static getExisting(info) {
    return streams.get(getStreamId(info));
  }
}

function onStreamFetch(event, params) {
  if (event.request.mode === 'navigate') {
    event.respondWith(new Response('', { status: 403, statusText: 'Forbidden' }));
    return;
  }

  event.respondWith(
    (async () => {
      try {
        const rangeHeader = event.request.headers.get('Range');
        const range = parseRange(rangeHeader);
        swDebug('fetch', 'stream intercept', {
          url: event.request.url.slice(0, 200),
          rangeHeader,
          range,
          clientId: event.clientId,
          mode: event.request.mode,
        });
        const info = parseInfo(params);
        const stream = Stream.get(info, event.clientId);
        return await stream.requestRange(range);
      } catch (err) {
        swDebug('fetch', 'stream intercept ERROR', String(err));
        return new Response(String(err), { status: 500 });
      }
    })()
  );
}

function toggleStreamInUse({ url, inUse }) {
  const needle = '/stream/';
  const index = url.indexOf(needle);
  if (index === -1) return;
  const params = url.slice(index + needle.length).split('?')[0];
  const info = parseInfo(params);
  const stream = inUse ? Stream.get(info) : Stream.getExisting(info);
  stream?.toggleInUse(inUse);
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === 'FORCE_CLAIM') {
    event.waitUntil(
      self.clients.claim().then((clients) => {
        swDebug('lifecycle', 'FORCE_CLAIM', { clientCount: clients?.length });
      })
    );
    return;
  }
  if (event.data?.type === 'toggleStreamInUse') {
    toggleStreamInUse(event.data);
  }
});

self.addEventListener('install', () => {
  swDebug('lifecycle', 'install', { STREAM_SW_REV });
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  swDebug('lifecycle', 'activate', {});
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const idx = url.pathname.indexOf('/stream/');
  if (idx === -1) return;
  const params = url.pathname.slice(idx + '/stream/'.length);
  onStreamFetch(event, params);
});