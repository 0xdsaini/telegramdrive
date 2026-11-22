import { streamDebug, streamDebugError } from './streamDebug';
import { messageMatchesFileName } from '../mtproto/messageContentShape';

/**
 * Resolve a stored metadata file entry to MTProto synthetic file id + size.
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
    if (message && !messageMatchesFileName(message, fileName)) {
      streamDebug('resolve', 'getMessage id mismatch — will search by filename', {
        messageId,
        gotMessageId: message.id,
        fileName,
      });
      message = null;
    }
  } catch {
    message = null;
  }

  if (!message?.content) {
    const searchResult = await telegramClient.send({
      '@type': 'searchChatMessages',
      chat_id: chatId,
      query: fileName,
      limit: 50,
      from_message_id: 0,
      offset: 0,
      only_missed: false,
    });

    if (searchResult?.messages?.length) {
      const exact = searchResult.messages.find((msg) => messageMatchesFileName(msg, fileName));
      if (exact) {
        streamDebug('resolve', 'search hit by exact filename', {
          fileName,
          messageId: exact.id,
          metadataMessageId: messageId,
        });
        message = exact;
      }
    }
  }

  if (!message?.content) {
    throw new Error('Message not found or has no content.');
  }

  const content = message.content;
  let fileId = null;
  let size = 0;
  const resolvedMessageId = message.id;

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
    metadataMessageId: messageId,
    message,
  };
  streamDebug('resolve', 'done', {
    fileId: out.fileId,
    size: out.size,
    messageId: out.messageId,
    metadataMessageId: out.metadataMessageId,
  });
  return out;
}