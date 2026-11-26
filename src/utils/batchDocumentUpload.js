import { isVideoFileName } from './mimeTypes';
import { generateVideoPosterJpeg } from './generateVideoPosterJpeg';
import { setCachedPoster } from './thumbnailCache';
import {
  createUploadBatchSession,
  closeUploadBatchSession,
} from '../mtproto/uploadBatchSession';
import { prefetchFileBuffer } from '../mtproto/uploadFileMtproto';
import { sendDocumentMtproto } from '../mtproto/sendDocumentMtproto';

/** @typedef {{ file: File, key: string, displayName?: string, meta?: unknown }} BatchUploadItem */

export const DEFAULT_BATCH_CONCURRENCY = 2;
/** 0 = flush metadata only at end of batch */
export const DEFAULT_METADATA_FLUSH_EVERY = 0;

/**
 * @param {File} file
 * @returns {Promise<{ thumb: File | null, posterBlob?: Blob }>}
 */
export async function prepareUploadThumb(file) {
  if (!isVideoFileName(file.name)) {
    return { thumb: null };
  }
  try {
    const uploadPoster = await generateVideoPosterJpeg(file);
    if (!uploadPoster?.blob) {
      return { thumb: null };
    }
    const thumb = new File([uploadPoster.blob], 'thumb.jpg', {
      type: 'image/jpeg',
    });
    return { thumb, posterBlob: uploadPoster.blob };
  } catch (posterErr) {
    console.warn(`Poster generation skipped for ${file.name}:`, posterErr);
    return { thumb: null };
  }
}

/**
 * Pipelined batch upload: shared MTProto session, optional concurrency, prefetch, deferred metadata.
 *
 * @param {object} params
 * @param {*} params.telegramClient TDLib compat shim (`_gram` = GramJS)
 * @param {number} params.chatId
 * @param {BatchUploadItem[]} params.items
 * @param {number} [params.concurrency]
 * @param {(progress: object) => void} [params.onProgress]
 * @param {(structure: object, opts: object) => Promise<boolean>} [params.saveMetadata]
 * @param {() => object} [params.getStructure]
 * @param {(structure: object, item: BatchUploadItem, messageId: number) => object} [params.onUploadSuccess]
 * @param {number} [params.metadataFlushEvery] 0 = end only
 * @param {(count: number, total: number) => void} [params.onCount]
 */
export async function runBatchDocumentUpload({
  telegramClient,
  chatId,
  items,
  concurrency = DEFAULT_BATCH_CONCURRENCY,
  onProgress,
  saveMetadata,
  getStructure,
  onUploadSuccess,
  metadataFlushEvery = DEFAULT_METADATA_FLUSH_EVERY,
  onCount,
}) {
  const gram = telegramClient?._gram;
  if (!gram) {
    throw new Error('Telegram MTProto client is not available');
  }
  if (!items?.length) {
    return { uploaded: 0, total: 0, errors: [] };
  }

  const session = await createUploadBatchSession(gram);
  const total = items.length;
  let uploaded = 0;
  const errors = [];

  /** @type {Map<number, Promise<{ thumb: File | null, posterBlob?: Blob, buffer: ArrayBuffer | null, thumbBuffer: ArrayBuffer | null }>>} */
  const prefetchByIndex = new Map();

  const schedulePrefetch = (index) => {
    if (index < 0 || index >= total || prefetchByIndex.has(index)) {
      return;
    }
    const item = items[index];
    prefetchByIndex.set(
      index,
      (async () => {
        const [thumbPack, buffer, thumbBuffer] = await Promise.all([
          prepareUploadThumb(item.file),
          prefetchFileBuffer(item.file),
          null,
        ]);
        let resolvedThumbBuffer = thumbBuffer;
        if (thumbPack.thumb) {
          resolvedThumbBuffer = await prefetchFileBuffer(thumbPack.thumb);
        }
        return {
          ...thumbPack,
          buffer,
          thumbBuffer: resolvedThumbBuffer,
        };
      })(),
    );
  };

  const prefetchHorizon = Math.max(concurrency, 2) + 1;
  for (let i = 0; i < Math.min(total, prefetchHorizon); i++) {
    schedulePrefetch(i);
  }

  let metadataTail = Promise.resolve();
  let structureChain = Promise.resolve();
  let completedSinceFlush = 0;

  const maybeFlushMetadata = (force = false) => {
    if (!saveMetadata || !getStructure) {
      return;
    }
    const shouldFlush =
      force
      || (metadataFlushEvery > 0 && completedSinceFlush >= metadataFlushEvery);
    if (!shouldFlush) {
      return;
    }
    completedSinceFlush = 0;
    const snapshot = getStructure();
    metadataTail = metadataTail.then(() =>
      saveMetadata(snapshot, {
        skipRemoteFetch: true,
        skipEditReturnDelay: true,
        uploadSession: session,
        bulk: true,
      }),
    );
  };

  const uploadOne = async (index) => {
    const item = items[index];
    schedulePrefetch(index + prefetchHorizon);

    const prepared = await (prefetchByIndex.get(index) || Promise.resolve({
      thumb: null,
      buffer: null,
      thumbBuffer: null,
    }));
    prefetchByIndex.delete(index);

    try {
      const message = await sendDocumentMtproto(gram, chatId, item.file, {
        uploadSession: session,
        prefetchBuffer: prepared.buffer,
        thumbPrefetchBuffer: prepared.thumbBuffer,
        thumb: prepared.thumb,
        onProgress: (p) => {
          onProgress?.({
            ...p,
            batchIndex: index + 1,
            batchTotal: total,
            displayName: item.displayName || item.key,
          });
        },
      });

      if (!message?.id) {
        throw new Error('No message ID returned');
      }
      const numericId =
        typeof message.id === 'bigint' ? Number(message.id) : Number(message.id);
      if (!Number.isFinite(numericId)) {
        throw new Error(`Invalid message id after upload: ${String(message.id)}`);
      }

      if (prepared.posterBlob) {
        try {
          await setCachedPoster(chatId, numericId, prepared.posterBlob, {
            durationSec: null,
            source: 'upload-jpeg',
          });
        } catch (cacheErr) {
          console.warn('Failed to cache upload poster:', cacheErr);
        }
      }

      if (onUploadSuccess && getStructure) {
        structureChain = structureChain.then(() => {
          onUploadSuccess(getStructure(), item, numericId);
        });
        await structureChain;
      }

      uploaded += 1;
      completedSinceFlush += 1;
      onCount?.(uploaded, total);
      maybeFlushMetadata(false);

      return { ok: true, index, messageId: numericId, item };
    } catch (err) {
      console.error(`Batch upload failed for ${item.key}:`, err);
      errors.push({ index, item, error: err });
      return { ok: false, index, error: err, item };
    }
  };

  const worker = async (taskQueue) => {
    while (taskQueue.length > 0) {
      const index = taskQueue.shift();
      if (index === undefined) {
        break;
      }
      await uploadOne(index);
    }
  };

  const taskQueue = items.map((_, i) => i);
  const workerCount = Math.min(Math.max(1, concurrency), total);
  await Promise.all(Array.from({ length: workerCount }, () => worker(taskQueue)));

  await metadataTail;
  await structureChain;

  if (saveMetadata && getStructure) {
    const finalStructure = getStructure();
    await saveMetadata(finalStructure, {
      skipRemoteFetch: false,
      skipEditReturnDelay: true,
      uploadSession: session,
      bulk: true,
    });
  }

  await closeUploadBatchSession(session);

  return { uploaded, total, errors };
}