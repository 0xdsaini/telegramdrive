import { getDocumentByFileId, updateDocumentFromApiDocument, registerDocumentFromMessage } from './documentRegistry';
import { streamDebug, streamDebugError } from '../utils/streamDebug';

/**
 * Re-fetch message media when upload.GetFile returns FILE_REFERENCE_* (telegram-tt pattern).
 */
export async function refreshDocumentFileReference(client, fileId) {
  const entry = getDocumentByFileId(fileId);
  if (!entry?.chatId || !entry?.messageId) {
    streamDebugError('mtproto', 'refreshDocumentFileReference: no chat/message on registry entry', { fileId });
    return false;
  }

  try {
    const msgs = await client.getMessages(entry.chatId, { ids: [entry.messageId] });
    const msg = msgs?.[0];
    const doc = msg?.media?.document;
    if (!doc) {
      streamDebugError('mtproto', 'refreshDocumentFileReference: message has no document', {
        fileId,
        messageId: entry.messageId,
      });
      return false;
    }
    updateDocumentFromApiDocument(fileId, doc);
    streamDebug('mtproto', 'refreshDocumentFileReference OK', { fileId, messageId: entry.messageId });
    return true;
  } catch (error) {
    streamDebugError('mtproto', 'refreshDocumentFileReference failed', error);
    return false;
  }
}

export function isFileReferenceError(error) {
  const msg = error?.errorMessage || error?.message || String(error);
  return /FILE_REFERENCE_/i.test(msg);
}

export async function ensureDocumentRegistered(client, chatId, messageId, preferredFileId) {
  const msgs = await client.getMessages(chatId, { ids: [messageId] });
  const msg = msgs?.[0];
  const doc = msg?.media?.document;
  if (!doc) {
    return null;
  }
  return registerDocumentFromMessage(doc, msg, preferredFileId);
}