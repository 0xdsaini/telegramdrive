import { streamDebug, streamDebugError } from './streamDebug';

/**
 * Resolve a stored metadata file entry to TDLib file id + size.
 */
export async function resolveTelegramFile(telegramClient, chatId, fileName, messageId) {
  streamDebug('resolve', 'start', { chatId, fileName, messageId });
  let message = null;

  try {
    message = await telegramClient.send({
      '@type': 'getMessage',
      chat_id: chatId,
      message_id: messageId,
    });
  } catch {
    message = null;
  }

  if (!message?.content) {
    const searchResult = await telegramClient.send({
      '@type': 'searchChatMessages',
      chat_id: chatId,
      query: fileName,
      limit: 10,
      from_message_id: 0,
      offset: 0,
      only_missed: false,
    });

    if (searchResult?.messages?.length) {
      for (const msg of searchResult.messages) {
        const doc = msg.content?.document;
        if (
          msg.content?.['@type'] === 'messageDocument' &&
          doc &&
          (doc.file_name === fileName || doc.document)
        ) {
          message = msg;
          break;
        }
        if (msg.content?.['@type'] === 'messageVideo' && doc?.file_name === fileName) {
          message = msg;
          break;
        }
        if (msg.content?.['@type'] === 'messageAudio') {
          message = msg;
          break;
        }
      }
    }
  }

  if (!message?.content) {
    throw new Error('Message not found or has no content.');
  }

  const content = message.content;
  let fileId = null;
  let size = 0;
  let resolvedMessageId = message.id;

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

  if (!fileId) {
    streamDebugError('resolve', 'no fileId', { contentType: content['@type'] });
    throw new Error('Could not resolve Telegram file id from message.');
  }

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
    messageId: resolvedMessageId,
    message,
  };
  streamDebug('resolve', 'done', { fileId: out.fileId, size: out.size, messageId: out.messageId });
  return out;
}