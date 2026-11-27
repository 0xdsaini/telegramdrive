import { streamDebug } from './streamDebug';

export const SUBTITLE_OFF_KEY = 'off';

/** Parse cues without painting the browser's default caption renderer */
export const SUBTITLE_TRACK_DISPLAY_MODE = 'hidden';

export const SIDECAR_SUBTITLE_TRACK_LABEL = 'Subtitles';

export const SIDECAR_SUBTITLE_CHOICE_KEY = 'label:Subtitles';

/**
 * Enable sidecar parse mode without toggling showing→hidden (Chrome can drop cues).
 * @returns {TextTrack | null}
 */
export function primeSidecarSubtitleTrack(video, preferredLabel = SIDECAR_SUBTITLE_TRACK_LABEL) {
  const tracks = video?.textTracks;
  if (!tracks?.length) return null;

  const labelNeedle = (preferredLabel || '').trim();
  let fallback = null;

  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (!isTextSubtitleTrack(track)) continue;
    if (!fallback) fallback = track;
    const label = (track.label || '').trim();
    if (labelNeedle && label !== labelNeedle) continue;

    if (track.mode === 'disabled' || track.mode === 'showing') {
      track.mode = SUBTITLE_TRACK_DISPLAY_MODE;
    }
    streamDebug('subtitle', 'prime sidecar', { label: track.label, mode: track.mode });
    return track;
  }

  if (fallback?.mode === 'disabled' || fallback?.mode === 'showing') {
    fallback.mode = SUBTITLE_TRACK_DISPLAY_MODE;
    streamDebug('subtitle', 'prime sidecar fallback', { label: fallback.label, mode: fallback.mode });
  }
  return fallback;
}

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

export function collectSubtitleTrackChoices(textTracks, sidecarSubtitleVtt = null) {
  const choices = [{ key: SUBTITLE_OFF_KEY, label: 'Off' }];
  if (textTracks?.length) {
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
  }
  if (
    sidecarSubtitleVtt
    && !choices.some((choice) => choice.key === SIDECAR_SUBTITLE_CHOICE_KEY)
  ) {
    choices.push({
      key: SIDECAR_SUBTITLE_CHOICE_KEY,
      label: SIDECAR_SUBTITLE_TRACK_LABEL,
    });
  }
  return choices;
}

export function defaultSidecarSubtitleKey(sidecarSubtitleVtt, textTracks, selectedKey) {
  if (!sidecarSubtitleVtt) return selectedKey;
  const choices = collectSubtitleTrackChoices(textTracks, sidecarSubtitleVtt);
  if (choices.length <= 1) return SUBTITLE_OFF_KEY;
  if (selectedKey !== SUBTITLE_OFF_KEY) return selectedKey;
  return SIDECAR_SUBTITLE_CHOICE_KEY;
}

export function syncActiveSubtitleTrackKey(video) {
  const tracks = video?.textTracks;
  if (!tracks?.length) return SUBTITLE_OFF_KEY;
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (
      isTextSubtitleTrack(track)
      && (track.mode === 'showing' || track.mode === SUBTITLE_TRACK_DISPLAY_MODE)
    ) {
      return subtitleTrackKey(track, i);
    }
  }
  return SUBTITLE_OFF_KEY;
}

export function selectSubtitleTrackByKey(video, key, sidecarSubtitleVtt = null) {
  if (key === SUBTITLE_OFF_KEY) {
    streamDebug('subtitle', 'select: off');
    const tracks = video?.textTracks;
    if (tracks?.length) {
      for (let i = 0; i < tracks.length; i += 1) {
        const track = tracks[i];
        if (!isTextSubtitleTrack(track)) continue;
        track.mode = 'disabled';
      }
    }
    return true;
  }

  if (key === SIDECAR_SUBTITLE_CHOICE_KEY && sidecarSubtitleVtt) {
    streamDebug('subtitle', 'select: sidecar');
    return true;
  }

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

  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (!isTextSubtitleTrack(track)) continue;
    if (subtitleTrackKey(track, i) === key) {
      track.mode = SUBTITLE_TRACK_DISPLAY_MODE;
      streamDebug('subtitle', 'select: active', { key, label: track.label });
      return true;
    }
  }

  streamDebug('subtitle', 'select: key not found', { key });
  return false;
}

/**
 * When a default <track> is present, prefer the first subtitles/captions track.
 */
export function applyInitialSubtitleTrackSelection(video, sidecarSubtitleVtt = null) {
  const tracks = video?.textTracks;
  const choices = collectSubtitleTrackChoices(tracks, sidecarSubtitleVtt);
  if (choices.length <= 1) {
    return { choices, activeKey: SUBTITLE_OFF_KEY };
  }

  let activeKey = SUBTITLE_OFF_KEY;
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    if (!isTextSubtitleTrack(track)) continue;
    if (track.mode === SUBTITLE_TRACK_DISPLAY_MODE) {
      activeKey = subtitleTrackKey(track, i);
      break;
    }
    if (track.mode === 'showing') {
      track.mode = SUBTITLE_TRACK_DISPLAY_MODE;
      activeKey = subtitleTrackKey(track, i);
      break;
    }
  }

  if (activeKey === SUBTITLE_OFF_KEY) {
    if (sidecarSubtitleVtt) {
      activeKey = SIDECAR_SUBTITLE_CHOICE_KEY;
    } else {
      const primed = primeSidecarSubtitleTrack(video);
      if (primed) {
        for (let i = 0; i < tracks.length; i += 1) {
          if (tracks[i] === primed) {
            activeKey = subtitleTrackKey(primed, i);
            break;
          }
        }
      }
    }
  }

  return { choices, activeKey };
}