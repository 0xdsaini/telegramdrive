import { streamDebug, streamDebugError } from './streamDebug';
import {
  deriveVideoFileNameFromMessage,
  messageMatchesRequestedFile,
} from './untrackedChatMedia';

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

async function searchMessageByFileName(telegramClient, chatId, fileName, messageId) {
  const searchResult = await telegramClient.send({
    '@type': 'searchChatMessages',
    chat_id: chatId,
    query: fileName,
    limit: 50,
    from_message_id: 0,
    offset: 0,
    only_missed: false,
  });

  const candidates = searchResult?.messages ?? [];
  if (!candidates.length) {
    return null;
  }

  if (messageId != null) {
    const byId = candidates.find(
      (msg) => msg.id === messageId && messageMatchesRequestedFile(msg, fileName),
    );
    if (byId) {
      streamDebug('resolve', 'search hit by message_id + filename', {
        messageId,
        fileName,
      });
      return byId;
    }
  }

  for (const msg of candidates) {
    if (messageMatchesRequestedFile(msg, fileName)) {
      streamDebug('resolve', 'search hit by exact filename', {
        messageId: msg.id,
        fileName,
      });
      return msg;
    }
  }

  return null;
}

/**
 * Resolve a stored metadata file entry to TDLib file id + size.
 */
export async function resolveTelegramFile(telegramClient, chatId, fileName, messageId) {
  streamDebug('resolve', 'start', { chatId, fileName, messageId });

  let message = await fetchMessage(telegramClient, chatId, messageId);

  if (message && !messageMatchesRequestedFile(message, fileName)) {
    streamDebug('resolve', 'metadata message_id points at different file', {
      messageId,
      requestedFileName: fileName,
      telegramFileName: message.content?.document?.file_name
        ?? message.content?.video?.file_name
        ?? deriveVideoFileNameFromMessage(message),
      resolvedMessageId: message.id,
    });
    message = null;
  }

  if (!message) {
    message = await searchMessageByFileName(telegramClient, chatId, fileName, messageId);
  }

  if (!message?.content) {
    throw new Error(
      `Could not find Telegram message for "${fileName}" (metadata message_id=${messageId}).`,
    );
  }

  if (!messageMatchesRequestedFile(message, fileName)) {
    throw new Error(
      `Resolved message #${message.id} is not "${fileName}". Check metadata message_id.`,
    );
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