const SUBTITLE_EXTENSIONS = new Set(['srt', 'vtt']);

/**
 * @param {string} fileName
 * @returns {string}
 */
export function fileNameBaseName(fileName) {
  if (!fileName) return '';
  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}

export function isSidecarSubtitleFileName(fileName) {
  const ext = fileName?.split('.').pop()?.toLowerCase();
  return SUBTITLE_EXTENSIONS.has(ext || '');
}

/**
 * VLC-style: same folder, `videoBase.srt` or `videoBase.vtt` for `videoBase.mp4`.
 * Prefers `.vtt` when both exist (native browser cues).
 *
 * @param {{ filename?: string, message_id?: number }[]} files
 * @param {string} videoFileName
 * @returns {{ filename: string, message_id: number } | null}
 */
export function findSiblingSubtitleFile(files, videoFileName) {
  if (!videoFileName || !Array.isArray(files) || files.length === 0) {
    return null;
  }

  const base = fileNameBaseName(videoFileName).toLowerCase();
  if (!base) return null;

  let srt = null;
  let vtt = null;

  for (const entry of files) {
    const name = entry?.filename;
    if (!name || !isSidecarSubtitleFileName(name)) continue;
    if (fileNameBaseName(name).toLowerCase() !== base) continue;
    if (entry.message_id == null || entry.message_id === '') continue;
    const numericId = Number(entry.message_id);
    if (!Number.isFinite(numericId)) continue;

    const normalized = { filename: name, message_id: numericId };
    const ext = name.split('.').pop().toLowerCase();
    if (ext === 'vtt') vtt = normalized;
    else if (ext === 'srt') srt = normalized;
  }

  return vtt || srt || null;
}

/**
 * @param {string} srtText
 * @returns {string}
 */
export function srtToVtt(srtText) {
  const lines = String(srtText || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  const cues = [];
  let i = 0;

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i += 1;
    if (i >= lines.length) break;

    if (/^\d+$/.test(lines[i].trim())) {
      i += 1;
    }
    if (i >= lines.length) break;

    const timeLine = lines[i];
    const timeMatch = timeLine.match(
      /(\d{1,2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{3})/,
    );
    if (!timeMatch) {
      i += 1;
      continue;
    }

    const start = timeMatch[1].replace(',', '.');
    const end = timeMatch[2].replace(',', '.');
    i += 1;

    const textLines = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i += 1;
    }

    if (textLines.length) {
      cues.push(`${start} --> ${end}\n${textLines.join('\n')}`);
    }
  }

  return cues.length ? `WEBVTT\n\n${cues.join('\n\n')}\n` : 'WEBVTT\n\n';
}