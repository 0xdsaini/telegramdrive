import { streamDebug } from './streamDebug';

export const SUBTITLE_OFF_KEY = 'off';

function isTextSubtitleTrack(track) {
  if (!track) return false;
  return track.kind === 'subtitles' || track.kind === 'captions';
}

export function subtitleTrackKey(track, index) {
  const label = (track?.label || '').trim();
  if (label) return `label:${label}`;
  const lang = (track?.language || '').trim().toLowerCase();
  if (lang) return `lang:${lang}:${index}`;
  return `index:${index}`;
}

export function collectSubtitleTrackChoices(textTracks) {
  const choices = [{ key: SUBTITLE_OFF_KEY, label: 'Off' }];
  if (!textTracks?.length) {
    return choices;
  }
  for (let i = 0; i < textTracks.length; i += 1) {
    const track = textTracks[i];
    if (!isTextSubtitleTrack(track)) continue;
    const label =
      (track.label || '').trim()
      || (track.language || '').trim()
      || `Subtitles ${choices.length}`;
    choices.push({
      index: i,
      key: subtitleTrackKey(track, i),
      label,
    });
  }
  return choices;
}

export function syncActiveSubtitleTrackKey(video) {
  const tracks = video?.textTracks;
  if (!tracks?.length) return SUBTITLE_OFF_KEY;
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (isTextSubtitleTrack(track) && track.mode === 'showing') {
      return subtitleTrackKey(track, i);
    }
  }
  return SUBTITLE_OFF_KEY;
}

export function selectSubtitleTrackByKey(video, key) {
  const tracks = video?.textTracks;
  if (!tracks?.length) {
    streamDebug('subtitle', 'select: no textTracks', { key });
    return false;
  }

  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (!isTextSubtitleTrack(track)) continue;
    track.mode = 'disabled';
  }

  if (key === SUBTITLE_OFF_KEY) {
    streamDebug('subtitle', 'select: off');
    return true;
  }

  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (!isTextSubtitleTrack(track)) continue;
    if (subtitleTrackKey(track, i) === key) {
      track.mode = 'showing';
      streamDebug('subtitle', 'select: showing', { key, label: track.label });
      return true;
    }
  }

  streamDebug('subtitle', 'select: key not found', { key });
  return false;
}

/**
 * When a default <track> is present, prefer the first subtitles/captions track.
 */
export function applyInitialSubtitleTrackSelection(video) {
  const tracks = video?.textTracks;
  const choices = collectSubtitleTrackChoices(tracks);
  if (choices.length <= 1) {
    return { choices, activeKey: SUBTITLE_OFF_KEY };
  }

  let activeKey = SUBTITLE_OFF_KEY;
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (!isTextSubtitleTrack(track)) continue;
    if (track.mode === 'showing') {
      activeKey = subtitleTrackKey(track, i);
      break;
    }
  }

  if (activeKey === SUBTITLE_OFF_KEY) {
    const firstSubIndex = choices[1]?.index;
    if (firstSubIndex != null) {
      const track = tracks[firstSubIndex];
      if (track) {
        track.mode = 'showing';
        activeKey = subtitleTrackKey(track, firstSubIndex);
      }
    }
  }

  return { choices, activeKey };
}