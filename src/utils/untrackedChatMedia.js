const METADATA_MARKER = 'METADATA_STORAGE';

const MIME_TO_EXT = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-matroska': '.mkv',
  'video/x-msvideo': '.avi',
};

export function getContentCaptionText(content) {
  const text = content?.caption?.text;
  return typeof text === 'string' ? text.trim() : '';
}

export function isMetadataStorageMessage(message) {
  return getContentCaptionText(message?.content).includes(METADATA_MARKER);
}

function extensionFromVideoContent(content) {
  const fileName = content?.video?.file_name;
  if (fileName && fileName.includes('.')) {
    return fileName.slice(fileName.lastIndexOf('.'));
  }
  const mime = content?.video?.mime_type || '';
  return MIME_TO_EXT[mime] || '.mp4';
}

function hasFileExtension(name) {
  const base = name.split('/').pop() || '';
  const idx = base.lastIndexOf('.');
  return idx > 0 && idx < base.length - 1;
}

export function sanitizeFileName(name) {
  const cleaned = name.replace(/[\0-\x1f\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || 'unnamed';
}

function ensureVideoNameHasExtension(filename, content) {
  if (hasFileExtension(filename)) {
    return filename;
  }
  return `${filename}${extensionFromVideoContent(content)}`;
}

/** Telegram's video.file_name when the sender supplied one. */
function internalVideoFileName(content) {
  const raw = content?.video?.file_name?.trim();
  if (!raw) {
    return null;
  }
  return ensureVideoNameHasExtension(sanitizeFileName(raw), content);
}

/**
 * Caption → internal file_name → null (caller uses unnamed video N).
 */
export function deriveVideoFileNameFromMessage(message) {
  const content = message?.content;
  if (!content) {
    return null;
  }

  const caption = getContentCaptionText(content);
  if (caption) {
    return ensureVideoNameHasExtension(sanitizeFileName(caption), content);
  }

  return internalVideoFileName(content);
}

export function deriveUnnamedVideoFileName(message, index) {
  const ext = extensionFromVideoContent(message.content);
  return `unnamed video ${index}${ext}`;
}

function messageMediaSize(message) {
  const type = message.content?.['@type'];
  if (type === 'messageDocument') {
    return message.content.document?.document?.size
      ?? message.content.document?.size
      ?? 0;
  }
  if (type === 'messageVideo') {
    return message.content.video?.video?.size
      ?? message.content.video?.size
      ?? 0;
  }
  return 0;
}

function ensureUniqueFilename(filename, usedNames) {
  if (!usedNames.has(filename)) {
    return filename;
  }
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (usedNames.has(candidate)) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  return candidate;
}

function nextUnnamedVideoIndex(trackedFilenames) {
  let next = 1;
  for (const name of trackedFilenames) {
    const match = /^unnamed video (\d+)(?:\.\w+)?$/i.exec(name);
    if (match) {
      next = Math.max(next, parseInt(match[1], 10) + 1);
    }
  }
  return next;
}

/**
 * Merge document + video search results and build untracked entries for the current folder.
 */
export function buildUntrackedFileEntries(messages, trackedFilenames) {
  const trackedSet = new Set(trackedFilenames);
  const usedNames = new Set(trackedFilenames);
  const entries = [];

  const namedVideos = [];
  const videosNeedingUnnamed = [];

  for (const message of messages) {
    if (!message?.content || isMetadataStorageMessage(message)) {
      continue;
    }

    const type = message.content['@type'];

    if (type === 'messageDocument' && message.content.document) {
      const filename = message.content.document.file_name;
      if (!filename || trackedSet.has(filename)) {
        continue;
      }
      const unique = ensureUniqueFilename(filename, usedNames);
      usedNames.add(unique);
      entries.push({
        messageId: message.id,
        filename: unique,
        size: messageMediaSize(message),
        date: new Date(message.date * 1000).toLocaleString(),
        mediaType: 'document',
      });
      continue;
    }

    if (type === 'messageVideo' && message.content.video) {
      const derived = deriveVideoFileNameFromMessage(message);
      if (derived) {
        namedVideos.push({ message, filename: derived });
      } else {
        videosNeedingUnnamed.push(message);
      }
    }
  }

  namedVideos.sort((a, b) => b.message.id - a.message.id);
  videosNeedingUnnamed.sort((a, b) => a.id - b.id);

  for (const { message, filename } of namedVideos) {
    if (trackedSet.has(filename)) {
      continue;
    }
    const unique = ensureUniqueFilename(filename, usedNames);
    usedNames.add(unique);
    entries.push({
      messageId: message.id,
      filename: unique,
      size: messageMediaSize(message),
      date: new Date(message.date * 1000).toLocaleString(),
      mediaType: 'video',
    });
  }

  let unnamedIndex = nextUnnamedVideoIndex(trackedFilenames);
  for (const message of videosNeedingUnnamed) {
    let unique;
    do {
      const candidate = deriveUnnamedVideoFileName(message, unnamedIndex);
      if (!trackedSet.has(candidate) && !usedNames.has(candidate)) {
        unique = candidate;
        break;
      }
      unnamedIndex += 1;
    } while (true);

    usedNames.add(unique);
    unnamedIndex += 1;
    entries.push({
      messageId: message.id,
      filename: unique,
      size: messageMediaSize(message),
      date: new Date(message.date * 1000).toLocaleString(),
      mediaType: 'video',
    });
  }

  return entries;
}

export function mergeChatMediaMessages(documentResult, videoResult) {
  const byId = new Map();
  for (const msg of [...(documentResult?.messages ?? []), ...(videoResult?.messages ?? [])]) {
    if (msg?.id != null) {
      byId.set(msg.id, msg);
    }
  }
  return [...byId.values()];
}