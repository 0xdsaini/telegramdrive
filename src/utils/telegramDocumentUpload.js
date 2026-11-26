import { sendDocumentMtproto } from '../mtproto/sendDocumentMtproto';
import { isVideoFileName } from './mimeTypes';
import { generateVideoPosterJpeg } from './generateVideoPosterJpeg';
import { setCachedPoster } from './thumbnailCache';

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
 * @param {{ onProgress?: (p: { done: number, total: number, fileName: string, ratio: number }) => void }} [opts]
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

  let uploadPoster = null;
  if (isVideoFileName(file.name)) {
    try {
      uploadPoster = await generateVideoPosterJpeg(file);
    } catch (posterErr) {
      console.warn(`Poster generation skipped for ${file.name}:`, posterErr);
    }
  }

  const thumb =
    uploadPoster?.blob
      ? new File([uploadPoster.blob], 'thumb.jpg', { type: 'image/jpeg' })
      : null;

  const message = await sendDocumentMtproto(gram, selectedChatId, file, {
    onProgress: opts.onProgress,
    thumb,
  });

  if (!message?.id) {
    throw new Error('No message ID returned');
  }

  const result = { id: message.id };

  if (uploadPoster?.blob) {
    try {
      await setCachedPoster(selectedChatId, result.id, uploadPoster.blob, {
        durationSec: null,
        source: 'upload-jpeg',
      });
    } catch (cacheErr) {
      console.warn('Failed to cache upload poster:', cacheErr);
    }
  }

  return { messageId: result.id, message };
};