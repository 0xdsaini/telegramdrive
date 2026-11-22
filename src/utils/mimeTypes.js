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
};

export function mimeTypeFromFileName(fileName) {
  if (!fileName) return 'application/octet-stream';
  const ext = fileName.split('.').pop()?.toLowerCase();
  return EXT_TO_MIME[ext] || 'application/octet-stream';
}

export function isStreamableMediaFileName(fileName) {
  const mime = mimeTypeFromFileName(fileName);
  return /^(?:video|audio)\//.test(mime);
}

export function isVideoFileName(fileName) {
  const mime = mimeTypeFromFileName(fileName);
  return mime.startsWith('video/');
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