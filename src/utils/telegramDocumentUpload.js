import { sendDocumentMtproto } from '../mtproto/sendDocumentMtproto';
import { isVideoFileName } from './mimeTypes';
import { generateVideoPosterJpeg } from './generateVideoPosterJpeg';
import { setCachedPoster } from './thumbnailCache';
import { prepareUploadThumb } from './batchDocumentUpload';

export const TELEGRAM_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

export const formatByteSize = (bytes) => {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  return `${(bytes / 1024).toFixed(2)} KB`;
};

/**
 * @param {File[]} files
 * @returns {{ file: File, displayName: string, size: number }[]}
 */
export const findOversizedUploadFiles = (files) => {
  const tooLarge = [];
  for (const file of files) {
    if (file.size > TELEGRAM_MAX_FILE_BYTES) {
      tooLarge.push({
        file,
        displayName: file.webkitRelativePath || file.name,
        size: file.size,
      });
    }
  }
  return tooLarge;
};

/**
 * Upload one local File as a Telegram document message (parallel MTProto upload + progress).
 * @param {*} telegramClient TDLib compat shim (`_gram` = GramJS client)
 * @param {number} selectedChatId
 * @param {File} file
 * @param {{ onProgress?: (p: { done: number, total: number, fileName: string, ratio: number }) => void, uploadSession?: object, thumb?: File | null, prefetchBuffer?: ArrayBuffer | null }} [opts]
 * @returns {Promise<{ messageId: number }>}
 */
export const sendFileDocumentToTelegram = async (
  telegramClient,
  selectedChatId,
  file,
  opts = {},
) => {
  const gram = telegramClient?._gram;
  if (!gram) {
    throw new Error('Telegram MTProto client is not available');
  }

  let thumb = opts.thumb ?? null;
  let posterBlob = null;
  if (!thumb && isVideoFileName(file.name)) {
    const prepared = await prepareUploadThumb(file);
    thumb = prepared.thumb;
    posterBlob = prepared.posterBlob;
  }

  const message = await sendDocumentMtproto(gram, selectedChatId, file, {
    onProgress: opts.onProgress,
    thumb,
    uploadSession: opts.uploadSession,
    prefetchBuffer: opts.prefetchBuffer,
  });

  if (!message?.id) {
    throw new Error('No message ID returned');
  }

  const numericId =
    typeof message.id === 'bigint' ? Number(message.id) : Number(message.id);
  if (!Number.isFinite(numericId)) {
    throw new Error(`Invalid message id after upload: ${String(message.id)}`);
  }

  if (posterBlob) {
    try {
      await setCachedPoster(selectedChatId, numericId, posterBlob, {
        durationSec: null,
        source: 'upload-jpeg',
      });
    } catch (cacheErr) {
      console.warn('Failed to cache upload poster:', cacheErr);
    }
  }

  return { messageId: numericId, message };
};