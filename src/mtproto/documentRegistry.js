/** @type {Map<number, object>} */
const byFileId = new Map();
/** @type {Map<string, number>} gram document id string -> synthetic fileId */
const byDocumentKey = new Map();
let nextSyntheticFileId = 1_000_000;

function documentKey(doc) {
  if (!doc?.id) return null;
  return `${doc.id.toString()}:${doc.accessHash?.toString?.() ?? doc.accessHash}`;
}

function docFields(doc) {
  return {
    size: Number(doc.size || 0),
    mimeType: doc.mimeType || 'application/octet-stream',
    fileName:
      doc.attributes?.find((a) => a.className === 'DocumentAttributeFilename')?.fileName || '',
    dcId: doc.dcId,
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference ? Buffer.from(doc.fileReference) : Buffer.alloc(0),
  };
}

function normalizeChatId(chatId) {
  if (chatId == null) return undefined;
  if (typeof chatId === 'bigint') return Number(chatId);
  return chatId;
}

export function registerDocumentFromMessage(doc, message, preferredFileId) {
  if (!doc?.id) return null;

  const key = documentKey(doc);
  if (key && byDocumentKey.has(key)) {
    const existingId = byDocumentKey.get(key);
    const existing = byFileId.get(existingId);
    if (existing) {
      Object.assign(existing, docFields(doc));
      if (message?.id != null) existing.messageId = message.id;
      if (message?.chatId != null) existing.chatId = normalizeChatId(message.chatId);
      return existing;
    }
  }

  let fileId = nextSyntheticFileId++;
  if (preferredFileId != null && !byFileId.has(Number(preferredFileId))) {
    fileId = Number(preferredFileId);
    if (fileId >= nextSyntheticFileId) {
      nextSyntheticFileId = fileId + 1;
    }
  }
  const entry = {
    fileId,
    ...docFields(doc),
    messageId: message?.id,
    chatId: normalizeChatId(message?.chatId),
  };
  byFileId.set(fileId, entry);
  if (key) byDocumentKey.set(key, fileId);
  return entry;
}

export function updateDocumentFromApiDocument(fileId, doc) {
  const entry = byFileId.get(Number(fileId));
  if (!entry || !doc) return null;
  Object.assign(entry, docFields(doc));
  return entry;
}

export function getDocumentByFileId(fileId) {
  return byFileId.get(Number(fileId));
}

export function clearDocumentRegistry() {
  byFileId.clear();
  byDocumentKey.clear();
}