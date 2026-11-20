import { resolveTelegramFile } from './telegramFileResolver';
import { getStreamUrl } from './streamUrl';
import { mimeTypeFromFileName } from './mimeTypes';
import { prepareForStreaming } from './streamBridge';
import { setCachedPoster } from './thumbnailCache';
import {
  capturePosterAfterSeeks,
  waitForVideoEvent,
} from './videoPosterCanvas';

const MAX_BACKFILL_CONCURRENT = 2;
let backfillActive = 0;
const backfillWaitQueue = [];

const attemptedBackfill = new Set();

function withBackfillSlot(fn) {
  return new Promise((resolve, reject) => {
    const task = async () => {
      backfillActive += 1;
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        backfillActive -= 1;
        runNextBackfill();
      }
    };

    if (backfillActive < MAX_BACKFILL_CONCURRENT) {
      task();
    } else {
      backfillWaitQueue.push(task);
    }
  });
}

function runNextBackfill() {
  while (backfillWaitQueue.length > 0 && backfillActive < MAX_BACKFILL_CONCURRENT) {
    const next = backfillWaitQueue.shift();
    next();
  }
}

/**
 * Lazy backfill: decode one frame via progressive stream URL and cache in IndexedDB only.
 * @returns {Promise<{ posterBlob: Blob|null, durationSec: number|null }>}
 */
export async function captureVideoPosterFromStream(
  telegramClient,
  chatId,
  messageId,
  fileName,
  { timeoutMs = 60000 } = {},
) {
  const key = `${chatId}:${messageId}`;
  if (attemptedBackfill.has(key)) {
    return { posterBlob: null, durationSec: null };
  }
  attemptedBackfill.add(key);

  return withBackfillSlot(async () => {
    if (!telegramClient || !chatId || !messageId || !fileName) {
      return { posterBlob: null, durationSec: null };
    }

    await prepareForStreaming(telegramClient, { force: false });

    const resolved = await resolveTelegramFile(telegramClient, chatId, fileName, messageId);
    const mimeType = mimeTypeFromFileName(fileName);
    const streamUrl = getStreamUrl({
      fileId: resolved.fileId,
      size: resolved.size,
      mimeType,
      fileName,
    });

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.preload = 'auto';

    try {
      video.src = streamUrl;
      await waitForVideoEvent(video, 'loadedmetadata', timeoutMs);
      const durationSec = Number.isFinite(video.duration) ? video.duration : null;
      const posterBlob = await capturePosterAfterSeeks(video, { timeoutMs });
      if (!posterBlob) {
        return { posterBlob: null, durationSec };
      }

      await setCachedPoster(chatId, messageId, posterBlob, {
        durationSec,
        source: 'client-stream',
      });

      return { posterBlob, durationSec };
    } catch {
      return { posterBlob: null, durationSec: null };
    } finally {
      video.removeAttribute('src');
      video.load();
    }
  });
}