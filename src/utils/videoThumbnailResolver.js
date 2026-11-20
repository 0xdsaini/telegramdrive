import { getCachedPoster, setCachedPoster } from './thumbnailCache';
import { downloadSmallTelegramFile } from './downloadSmallTelegramFile';

const MAX_CONCURRENT = 4;
let active = 0;
const waitQueue = [];

function runNext() {
  if (active >= MAX_CONCURRENT || waitQueue.length === 0) {
    return;
  }
  active += 1;
  const { run, release } = waitQueue.shift();
  Promise.resolve()
    .then(run)
    .finally(() => {
      active -= 1;
      release();
      runNext();
    });
}

function withConcurrency(fn) {
  return new Promise((resolve, reject) => {
    const release = () => {};
    const run = async () => {
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      }
    };
    waitQueue.push({ run, release });
    runNext();
  });
}

const inflight = new Map();

function minithumbnailToBlob(minithumbnail) {
  if (!minithumbnail?.data || typeof minithumbnail.data !== 'string') {
    return null;
  }
  try {
    const binary = atob(minithumbnail.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Blob([bytes], { type: 'image/jpeg' });
  } catch {
    return null;
  }
}

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

export function extractVideoThumbMeta(message) {
  const content = message?.content;
  let durationSec = null;
  let thumbFileId = null;

  const miniBlob = minithumbnailToBlob(message?.minithumbnail);

  if (content?.['@type'] === 'messageVideo') {
    const video = content.video;
    if (typeof video?.duration === 'number') {
      durationSec = video.duration;
    }
    const thumb = video?.thumbnail;
    if (thumb?.file?.id) {
      thumbFileId = thumb.file.id;
    }
  } else if (content?.['@type'] === 'messageDocument') {
    const doc = content.document;
    durationSec = durationFromDocument(doc);
    const thumb = doc?.thumbnail;
    if (thumb?.file?.id) {
      thumbFileId = thumb.file.id;
    }
  }

  return { miniBlob, thumbFileId, durationSec };
}

async function fetchPosterFromTelegram(telegramClient, chatId, messageId) {
  const message = await telegramClient.send({
    '@type': 'getMessage',
    chat_id: chatId,
    message_id: messageId,
  });

  if (message?.['@type'] === 'error') {
    throw new Error(message.message || 'getMessage failed');
  }

  const { miniBlob, thumbFileId, durationSec } = extractVideoThumbMeta(message);
  let posterBlob = null;
  let source = null;

  if (thumbFileId) {
    try {
      posterBlob = await downloadSmallTelegramFile(telegramClient, thumbFileId);
      source = 'tdlib';
    } catch {
      posterBlob = null;
    }
  }

  if (!posterBlob && miniBlob) {
    posterBlob = miniBlob;
    source = 'minithumbnail';
  }

  if (posterBlob) {
    await setCachedPoster(chatId, messageId, posterBlob, { durationSec, source });
  }

  return { posterBlob, durationSec, source };
}

/**
 * Resolve a video poster from IndexedDB or Telegram (minithumbnail / document|video thumbnail).
 * @returns {Promise<{ posterBlob: Blob|null, durationSec: number|null, source: string|null }>}
 */
export async function resolveVideoPoster(telegramClient, chatId, messageId) {
  if (!telegramClient || !chatId || !messageId) {
    return { posterBlob: null, durationSec: null, source: null };
  }

  const cached = await getCachedPoster(chatId, messageId);
  if (cached?.blob) {
    return {
      posterBlob: cached.blob,
      durationSec: cached.durationSec,
      source: cached.source,
    };
  }

  const key = `${chatId}:${messageId}`;
  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = withConcurrency(() => fetchPosterFromTelegram(telegramClient, chatId, messageId)).finally(
    () => inflight.delete(key),
  );
  inflight.set(key, promise);
  return promise;
}