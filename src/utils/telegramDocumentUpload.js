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
 * Upload one local File as a Telegram document message.
 * @returns {Promise<{ messageId: number }>}
 */
export const sendFileDocumentToTelegram = async (telegramClient, selectedChatId, file) => {
  let uploadPoster = null;
  if (isVideoFileName(file.name)) {
    try {
      uploadPoster = await generateVideoPosterJpeg(file);
    } catch (posterErr) {
      console.warn(`Poster generation skipped for ${file.name}:`, posterErr);
    }
  }

  const inputMessageContent = {
    '@type': 'inputMessageDocument',
    document: {
      '@type': 'inputFileBlob',
      name: file.name,
      data: file,
    },
    disable_content_type_detection: false,
  };

  if (uploadPoster?.blob) {
    inputMessageContent.thumbnail = {
      '@type': 'inputThumbnail',
      thumbnail: {
        '@type': 'inputFileBlob',
        name: 'thumb.jpg',
        data: uploadPoster.blob,
      },
      width: uploadPoster.width,
      height: uploadPoster.height,
    };
  }

  const result = await telegramClient.send({
    '@type': 'sendMessage',
    chat_id: selectedChatId,
    input_message_content: inputMessageContent,
  });

  if (!result?.id) {
    throw new Error('No message ID returned');
  }

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

  return { messageId: result.id };
};