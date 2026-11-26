export const METADATA_MARKER = 'METADATA_STORAGE';
export const METADATA_FILENAME = 'metadata.json';

const METADATA_MESSAGE_KEY_PREFIX = 'telegram-metadata-message-id';
const LEGACY_METADATA_MESSAGE_KEY = 'telegram-metadata-message-id';

export function metadataMessageStorageKey(chatId) {
  if (chatId == null) {
    return LEGACY_METADATA_MESSAGE_KEY;
  }
  return `${METADATA_MESSAGE_KEY_PREFIX}-${chatId}`;
}

export function isMetadataStorageMessage(message) {
  if (!message?.content) {
    return false;
  }
  const textBody = message.content.text?.text;
  if (textBody?.includes(METADATA_MARKER)) {
    return true;
  }
  const caption = message.content.caption?.text;
  if (caption?.includes(METADATA_MARKER)) {
    return true;
  }
  const docName = message.content.document?.file_name;
  if (docName === METADATA_FILENAME) {
    return true;
  }
  return false;
}

/** Single canonical metadata message per chat (oldest match). */
export function pickCanonicalMetadataMessage(messages) {
  const matches = (messages ?? []).filter(isMetadataStorageMessage);
  if (matches.length === 0) {
    return null;
  }
  return matches.reduce((oldest, msg) => (msg.id < oldest.id ? msg : oldest));
}

export function rememberMetadataMessageId(chatId, messageId) {
  if (chatId == null || messageId == null) {
    return messageId;
  }
  localStorage.setItem(metadataMessageStorageKey(chatId), String(messageId));
  return messageId;
}

export function readSavedMetadataMessageId(chatId) {
  const perChat = localStorage.getItem(metadataMessageStorageKey(chatId));
  if (perChat) {
    return perChat;
  }
  const legacy = localStorage.getItem(LEGACY_METADATA_MESSAGE_KEY);
  return legacy || null;
}

/** Remove cached metadata message ids (logout / reset). */
export function clearMetadataMessageIdsFromLocalStorage() {
  localStorage.removeItem(LEGACY_METADATA_MESSAGE_KEY);
  const prefix = `${METADATA_MESSAGE_KEY_PREFIX}-`;
  const toRemove = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      toRemove.push(key);
    }
  }
  toRemove.forEach((key) => localStorage.removeItem(key));
}