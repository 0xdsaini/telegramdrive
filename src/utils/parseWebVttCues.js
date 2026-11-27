/**
 * @typedef {{ startTime: number, endTime: number, text: string }} ParsedVttCue
 */

/**
 * @param {string} timestamp
 * @returns {number}
 */
export function vttTimestampToSeconds(timestamp) {
  const normalized = String(timestamp || '').trim().replace(',', '.');
  if (!normalized) return NaN;
  const segments = normalized.split(':').map((part) => Number(part));
  if (segments.some((n) => !Number.isFinite(n))) return NaN;
  if (segments.length === 3) {
    return segments[0] * 3600 + segments[1] * 60 + segments[2];
  }
  if (segments.length === 2) {
    return segments[0] * 60 + segments[1];
  }
  return segments[0];
}

/**
 * @param {string} vttText
 * @returns {ParsedVttCue[]}
 */
export function parseWebVttCues(vttText) {
  const body = String(vttText || '').replace(/^\uFEFF/, '');
  if (!body.trim()) return [];

  const lines = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const cues = [];
  let i = 0;

  while (i < lines.length && !/^\d{2}:\d{2}/.test(lines[i]) && !/^\d{1,2}:\d{2}:\d{2}/.test(lines[i])) {
    i += 1;
  }

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i += 1;
    if (i >= lines.length) break;

    if (lines[i].includes('-->')) {
      /* inline timestamp */
    } else if (/^\d+$/.test(lines[i].trim())) {
      i += 1;
      if (i >= lines.length) break;
    }

    const timeLine = lines[i];
    const timeMatch = timeLine.match(
      /(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[.,]\d{3})/,
    );
    if (!timeMatch) {
      i += 1;
      continue;
    }

    const startTime = vttTimestampToSeconds(timeMatch[1]);
    const endTime = vttTimestampToSeconds(timeMatch[2]);
    i += 1;

    const textLines = [];
    while (i < lines.length && lines[i].trim() !== '') {
      if (lines[i].includes('-->')) break;
      textLines.push(lines[i]);
      i += 1;
    }

    if (Number.isFinite(startTime) && Number.isFinite(endTime) && textLines.length) {
      cues.push({
        startTime,
        endTime,
        text: textLines.join('\n'),
      });
    }
  }

  return cues;
}

/**
 * @param {ParsedVttCue[]} cues
 * @param {number} time
 * @returns {ParsedVttCue | null}
 */
export function findParsedVttCueAtTime(cues, time) {
  if (!cues?.length || !Number.isFinite(time)) return null;
  for (let i = 0; i < cues.length; i += 1) {
    const cue = cues[i];
    if (time >= cue.startTime && time < cue.endTime) return cue;
  }
  return null;
}