import { getCachedPoster, deleteCachedPoster } from './thumbnailCache';
import { isTrustedPosterSource } from './posterSources';
import { whenThumbsStorePendingWork } from './telegramThumbsStore';

import { DOWNLOAD_WORKERS } from '../mtproto/downloadConcurrency';

const MAX_CONCURRENT = DOWNLOAD_WORKERS;
let active = 0;
const waitQueue = [];

function runNext() {
  if (active >= MAX_CONCURRENT || waitQueue.length === 0) {
    return;
  }
  active += 1;
  const { run } = waitQueue.shift();
  Promise.resolve()
    .then(run)
    .finally(() => {
      active -= 1;
      runNext();
    });
}

function withConcurrency(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    };
    waitQueue.push({ run });
    runNext();
  });
}

const inflight = new Map();

function durationFromDocument(document) {
  const attrs = document?.attributes;
  if (!Array.isArray(attrs)) {
    return null;
  }
  for (const attr of attrs) {
    if (attr?.['@type'] === 'documentAttributeVideo' && typeof attr.duration === 'number') {
      return attr.duration;
    }
  }
  return null;
}

export function extractVideoDurationFromMessage(message) {
  const content = message?.content;
  if (content?.['@type'] === 'messageVideo') {
    const d = content.video?.duration;
    return typeof d === 'number' ? d : null;
  }
  if (content?.['@type'] === 'messageDocument') {
    return durationFromDocument(content.document);
  }
  return null;
}

async function fetchDurationFromTelegram(telegramClient, chatId, messageId) {
  const message = await telegramClient.send({
    '@type': 'getMessage',
    chat_id: chatId,
    message_id: messageId,
  });

  if (message?.['@type'] === 'error') {
    throw new Error(message.message || 'getMessage failed');
  }

  return { durationSec: extractVideoDurationFromMessage(message) };
}

/**
 * Only returns cached client/upload posters or metadata for stream extraction.
 * Telegram minithumbnail / server thumbs are ignored (not meaningful for documents or messageVideo).
 */
export async function resolveVideoPoster(telegramClient, chatId, messageId) {
  if (!telegramClient || !chatId || !messageId) {
    return {
      posterBlob: null,
      durationSec: null,
      source: null,
      needsBackfill: false,
    };
  }

  await whenThumbsStorePendingWork(chatId);

  const cached = await getCachedPoster(chatId, messageId);
  if (cached?.blob) {
    if (isTrustedPosterSource(cached.source)) {
      return {
        posterBlob: cached.blob,
        durationSec: cached.durationSec,
        source: cached.source,
        needsBackfill: false,
      };
    }
    try {
      await deleteCachedPoster(chatId, messageId);
    } catch {
      /* ignore */
    }
  }

  const key = `${chatId}:${messageId}`;
  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = withConcurrency(async () => {
    let durationSec = cached?.durationSec ?? null;
    try {
      const meta = await fetchDurationFromTelegram(telegramClient, chatId, messageId);
      if (meta.durationSec != null) {
        durationSec = meta.durationSec;
      }
    } catch {
      /* duration optional */
    }
    return {
      posterBlob: null,
      durationSec,
      source: null,
      needsBackfill: true,
    };
  }).finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}