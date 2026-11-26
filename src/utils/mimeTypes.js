const EXT_TO_MIME = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  flac: 'audio/flac',
  aac: 'audio/aac',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  mid: 'audio/midi',
  midi: 'audio/midi',
};

export function mimeTypeFromFileName(fileName) {
  if (!fileName) return 'application/octet-stream';
  const ext = fileName.split('.').pop()?.toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

export function isStreamableMimeType(mime) {
  return /^(?:video|audio)\//.test(mime || '');
}

export function isStreamableMediaFileName(fileName) {
  return isStreamableMimeType(mimeTypeFromFileName(fileName));
}

export function isVideoFileName(fileName) {
  const mime = mimeTypeFromFileName(fileName);
  return mime.startsWith('video/');
}

export function isAudioFileName(fileName) {
  return mimeTypeFromFileName(fileName).startsWith('audio/');
}

/** Prefer filename extension; fall back to Telegram message mime for extensionless names. */
export function mimeTypeFromTelegramContent(message, fileName) {
  const fromName = mimeTypeFromFileName(fileName);
  if (fromName !== 'application/octet-stream') {
    return fromName;
  }
  const content = message?.content;
  if (!content) {
    return fromName;
  }
  const type = content['@type'];
  if (type === 'messageDocument') {
    const mime = content.document?.mime_type;
    if (mime && mime !== 'application/octet-stream') {
      return mime;
    }
  }
  if (type === 'messageAudio') {
    return content.audio?.mime_type || 'audio/mpeg';
  }
  if (type === 'messageVideo') {
    return content.video?.mime_type || fromName;
  }
  return fromName;
}

export function isAudioPlayback(fileName, message) {
  const mime = mimeTypeFromTelegramContent(message, fileName);
  return mime.startsWith('audio/');
}

export function formatVideoDuration(totalSeconds) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '';
  }
  const sec = Math.floor(totalSeconds);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}