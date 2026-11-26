import { streamDebug, streamDebugError } from './streamDebug';
import { messageHasPlayableFileContent } from './untrackedChatMedia';

function isTdlibError(value) {
  return value?.['@type'] === 'error';
}

async function fetchMessage(telegramClient, chatId, messageId) {
  try {
    const message = await telegramClient.send({
      '@type': 'getMessage',
      chat_id: chatId,
      message_id: messageId,
    });
    if (isTdlibError(message) || !message?.content) {
      return null;
    }
    return message;
  } catch {
    return null;
  }
}

function extractFileFromMessage(message) {
  const content = message.content;
  let fileId = null;
  let size = 0;

  if (content['@type'] === 'messageDocument') {
    const doc = content.document;
    if (doc?.document?.id) {
      fileId = doc.document.id;
      size = doc.document.size || doc.size || 0;
    } else if (doc?.id) {
      fileId = doc.id;
      size = doc.size || 0;
    }
  } else if (content['@type'] === 'messageVideo') {
    const video = content.video;
    fileId = video?.video?.id;
    size = video?.video?.size || video?.size || 0;
  } else if (content['@type'] === 'messageAudio') {
    const audio = content.audio;
    fileId = audio?.audio?.id;
    size = audio?.audio?.size || audio?.size || 0;
  } else if (content['@type'] === 'messageAnimation') {
    fileId = content.animation?.animation?.id;
    size = content.animation?.animation?.size || 0;
  }

  return { fileId, size };
}

/**
 * Resolve a metadata file entry to TDLib file id + size via message_id only.
 * @param {*} telegramClient
 * @param {number} chatId
 * @param {string} [fileName] Display / MIME hints only; not used to locate the message.
 * @param {number} messageId
 */
export async function resolveTelegramFile(telegramClient, chatId, fileName, messageId) {
  const numericMessageId = Number(messageId);
  streamDebug('resolve', 'start', { chatId, fileName, messageId: numericMessageId });

  if (!Number.isFinite(numericMessageId)) {
    throw new Error(`Invalid message_id for "${fileName ?? 'file'}".`);
  }

  const message = await fetchMessage(telegramClient, chatId, numericMessageId);

  if (!message) {
    throw new Error(`Could not load Telegram message #${numericMessageId}.`);
  }

  if (!messageHasPlayableFileContent(message)) {
    throw new Error(`Message #${numericMessageId} has no downloadable media.`);
  }

  const { fileId, size: contentSize } = extractFileFromMessage(message);
  if (!fileId) {
    streamDebugError('resolve', 'no fileId', { contentType: message.content['@type'] });
    throw new Error(`Could not resolve file id from message #${numericMessageId}.`);
  }

  let size = contentSize;
  const fileInfo = await telegramClient.send({
    '@type': 'getFile',
    file_id: fileId,
  });
  streamDebug('resolve', 'getFile', fileInfo);

  if (fileInfo?.size) {
    size = fileInfo.size;
  }

  const out = {
    fileId,
    size,
    messageId: message.id,
    message,
  };
  streamDebug('resolve', 'done', {
    fileId: out.fileId,
    size: out.size,
    messageId: out.messageId,
    fileName,
  });
  return out;
}