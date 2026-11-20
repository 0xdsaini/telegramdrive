import { resolveTelegramFile } from './telegramFileResolver';
import { getStreamUrl } from './streamUrl';
import { mimeTypeFromFileName } from './mimeTypes';
import {
  isPosterBackfillAllowed,
  prepareForStreaming,
  toggleStreamInUse,
} from './streamBridge';
import { setCachedPoster } from './thumbnailCache';
import {
  capturePosterAfterSeeks,
  waitForVideoEvent,
} from './videoPosterCanvas';

const MAX_BACKFILL_CONCURRENT = 1;
let backfillActive = 0;
const backfillWaitQueue = [];

const backfillInflight = new Map();

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

function waitForPosterSlot(fileId, maxMs = 120_000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (isPosterBackfillAllowed(fileId)) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= maxMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 400);
    };
    tick();
  });
}

/**
 * Lazy backfill: decode one frame via progressive stream URL and cache in IndexedDB only.
 * Does not run while the video player is open or the same file is playing (avoids TDLib/SW contention).
 * @returns {Promise<{ posterBlob: Blob|null, durationSec: number|null, skipped?: boolean }>}
 */
export async function captureVideoPosterFromStream(
  telegramClient,
  chatId,
  messageId,
  fileName,
  { timeoutMs = 60000 } = {},
) {
  const key = `${chatId}:${messageId}`;
  if (backfillInflight.has(key)) {
    return backfillInflight.get(key);
  }

  const promise = withBackfillSlot(async () => {
    if (!telegramClient || !chatId || !messageId || !fileName) {
      return { posterBlob: null, durationSec: null };
    }

    let resolved;
    try {
      resolved = await resolveTelegramFile(telegramClient, chatId, fileName, messageId);
    } catch {
      return { posterBlob: null, durationSec: null };
    }

    const allowed = await waitForPosterSlot(resolved.fileId);
    if (!allowed) {
      return { posterBlob: null, durationSec: null, skipped: true };
    }

    try {
      await prepareForStreaming(telegramClient, { force: false, allowReload: false });
    } catch {
      return { posterBlob: null, durationSec: null, skipped: true };
    }

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
    video.preload = 'metadata';

    toggleStreamInUse(streamUrl, true);

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
      video.pause();
      video.removeAttribute('src');
      video.load();
      toggleStreamInUse(streamUrl, false);
    }
  });

  backfillInflight.set(key, promise);
  return promise.finally(() => backfillInflight.delete(key));
}