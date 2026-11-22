import { registerDocumentFromMessage } from './documentRegistry';
import { deriveVideoFileNameFromMessage } from '../utils/untrackedChatMedia';

function normalizeChatId(chatId) {
  if (chatId == null) return undefined;
  if (typeof chatId === 'bigint') return Number(chatId);
  if (typeof chatId === 'string' && /^-?\d+$/.test(chatId)) {
    return Number(chatId);
  }
  return chatId;
}

function isVideoDocument(doc) {
  return doc?.attributes?.some((a) => a.className === 'DocumentAttributeVideo');
}

export function messageContentDocumentName(tdlibContent) {
  const type = tdlibContent?.['@type'];
  if (type === 'messageDocument') {
    return tdlibContent.document?.file_name || '';
  }
  if (type === 'messageVideo') {
    return tdlibContent.video?.file_name || '';
  }
  return '';
}

export function messageMatchesFileName(message, fileName) {
  if (!message?.content || !fileName) return false;
  if (message.content['@type'] === 'messageDocument') {
    const docName = message.content.document?.file_name;
    if (docName === fileName) return true;
    return deriveVideoFileNameFromMessage(message) === fileName;
  }
  if (message.content['@type'] === 'messageVideo') {
    const videoName = message.content.video?.file_name;
    if (videoName === fileName) return true;
    return deriveVideoFileNameFromMessage(message) === fileName;
  }
  return false;
}

export function messageToTdlibShape(msg) {
  if (!msg) return null;

  const media = msg.media;
  const chatId = normalizeChatId(msg.chatId);
  const captionText = msg.message || '';

  if (media?.className === 'MessageMediaDocument' && media.document) {
    const reg = registerDocumentFromMessage(media.document, msg);
    const fileId = reg.fileId;
    const size = reg.size;
    const fileName = reg.fileName;
    const mimeType = reg.mimeType;

    if (isVideoDocument(media.document)) {
      return {
        '@type': 'message',
        id: msg.id,
        chat_id: chatId,
        content: {
          '@type': 'messageVideo',
          video: {
            '@type': 'video',
            file_name: fileName,
            mime_type: mimeType,
            video: { '@type': 'file', id: fileId, size },
          },
          caption: captionText ? { '@type': 'formattedText', text: captionText } : undefined,
        },
      };
    }

    return {
      '@type': 'message',
      id: msg.id,
      chat_id: chatId,
      content: {
        '@type': 'messageDocument',
        document: {
          '@type': 'document',
          file_name: fileName,
          mime_type: mimeType,
          document: { '@type': 'file', id: fileId, size },
        },
        caption: captionText ? { '@type': 'formattedText', text: captionText } : undefined,
      },
    };
  }

  if (media?.className === 'MessageMediaPhoto') {
    return {
      '@type': 'message',
      id: msg.id,
      chat_id: chatId,
      content: { '@type': 'messagePhoto' },
    };
  }

  return {
    '@type': 'message',
    id: msg.id,
    chat_id: chatId,
    content: captionText ? { '@type': 'messageText', text: { text: captionText } } : {},
  };
}