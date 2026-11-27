import { SUBTITLE_TRACK_DISPLAY_MODE } from './videoSubtitleTracks';

const MAX_SUBTITLE_LINES = 2;

function isActiveSubtitleTrackMode(mode) {
  return mode === SUBTITLE_TRACK_DISPLAY_MODE || mode === 'showing';
}

function stripCueMarkup(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : '';
    })
    .trim();
}

/**
 * @param {HTMLVideoElement | null | undefined} video
 * @returns {string[]}
 */
export function getActiveSubtitleCueLines(video) {
  const tracks = video?.textTracks;
  if (!tracks?.length) return [];

  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
    if (!isActiveSubtitleTrackMode(track.mode)) continue;

    const activeCues = track.activeCues;
    if (!activeCues?.length) return [];

    const cue = activeCues[0];
    const raw = typeof cue.text === 'string' ? cue.text : cue.getCueAsHTML?.()?.textContent || '';
    const lines = stripCueMarkup(raw)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.slice(0, MAX_SUBTITLE_LINES);
  }

  return [];
}