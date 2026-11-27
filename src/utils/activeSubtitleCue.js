import { SUBTITLE_TRACK_DISPLAY_MODE } from './videoSubtitleTracks';

const MAX_SUBTITLE_LINES = 2;

function isActiveSubtitleTrackMode(mode) {
  return mode === SUBTITLE_TRACK_DISPLAY_MODE || mode === 'showing';
}

function findCueAtTime(track, time) {
  const list = track?.cues;
  if (!list?.length || !Number.isFinite(time)) return null;
  for (let i = 0; i < list.length; i += 1) {
    const cue = list[i];
    if (time >= cue.startTime && time < cue.endTime) return cue;
  }
  return null;
}

export function subtitleTextToLines(text) {
  return stripCueMarkup(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_SUBTITLE_LINES);
}

function cueToLines(cue) {
  const raw = typeof cue?.text === 'string'
    ? cue.text
    : cue?.getCueAsHTML?.()?.textContent || '';
  return stripCueMarkup(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_SUBTITLE_LINES);
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

  const time = Number.isFinite(video.currentTime) ? video.currentTime : 0;

  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
    if (!isActiveSubtitleTrackMode(track.mode)) continue;

    const activeCues = track.activeCues;
    let cue = activeCues?.length ? activeCues[0] : findCueAtTime(track, time);
    if (!cue) continue;

    return cueToLines(cue);
  }

  return [];
}