import { streamDebug } from './streamDebug';

const AUDIO_PREF_STORAGE_PREFIX = 'td-audio-track:';

const LANGUAGE_DISPLAY_NAMES = {
  eng: 'English',
  en: 'English',
  hin: 'Hindi',
  hi: 'Hindi',
  tam: 'Tamil',
  ta: 'Tamil',
  tel: 'Telugu',
  te: 'Telugu',
  kan: 'Kannada',
  kn: 'Kannada',
  mal: 'Malayalam',
  ml: 'Malayalam',
  mar: 'Marathi',
  mr: 'Marathi',
  ben: 'Bengali',
  bn: 'Bengali',
  guj: 'Gujarati',
  gu: 'Gujarati',
  pan: 'Punjabi',
  pa: 'Punjabi',
  urd: 'Urdu',
  ur: 'Urdu',
  jpn: 'Japanese',
  ja: 'Japanese',
  kor: 'Korean',
  ko: 'Korean',
  zho: 'Chinese',
  zh: 'Chinese',
  cmn: 'Chinese',
  fra: 'French',
  fr: 'French',
  deu: 'German',
  de: 'German',
  spa: 'Spanish',
  es: 'Spanish',
  por: 'Portuguese',
  pt: 'Portuguese',
  rus: 'Russian',
  ru: 'Russian',
  ara: 'Arabic',
  ar: 'Arabic',
};

export function isEnglishAudioLanguage(language) {
  const lang = (language || '').toLowerCase();
  return lang === 'eng' || lang === 'en' || lang.startsWith('en-');
}

export function audioTrackKey(track, index) {
  const id = (track?.id || '').trim();
  if (id) return id;
  const language = (track?.language || 'und').toLowerCase();
  return `${language}:${index}`;
}

export function formatAudioTrackLabel(track, index) {
  const label = (track?.label || '').trim();
  if (label) return label;
  const lang = (track?.language || '').toLowerCase();
  if (LANGUAGE_DISPLAY_NAMES[lang]) return LANGUAGE_DISPLAY_NAMES[lang];
  if (lang && lang !== 'und') {
    return lang.length <= 3 ? lang.toUpperCase() : lang;
  }
  return `Audio ${index + 1}`;
}

export function collectAudioTrackChoices(tracks) {
  if (!tracks?.length) return [];
  const choices = [];
  for (let i = 0; i < tracks.length; i += 1) {
    const track = tracks[i];
    choices.push({
      index: i,
      key: audioTrackKey(track, i),
      label: formatAudioTrackLabel(track, i),
      language: track.language || '',
    });
  }
  return choices;
}

export function findAudioTrackByKey(tracks, key) {
  if (!tracks?.length || !key) return null;
  for (let i = 0; i < tracks.length; i += 1) {
    if (audioTrackKey(tracks[i], i) === key) return tracks[i];
  }
  return null;
}

export function enableOnlyAudioTrack(tracks, activeTrack) {
  if (!tracks?.length || !activeTrack) return;
  for (let i = 0; i < tracks.length; i += 1) {
    tracks[i].enabled = tracks[i] === activeTrack;
  }
}

export function readSavedAudioTrackKey(fileId) {
  if (!fileId || typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(`${AUDIO_PREF_STORAGE_PREFIX}${fileId}`);
  } catch {
    return null;
  }
}

export function writeSavedAudioTrackKey(fileId, trackKey) {
  if (!fileId || !trackKey || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${AUDIO_PREF_STORAGE_PREFIX}${fileId}`, trackKey);
  } catch {
    /* ignore quota */
  }
}

/**
 * Populate UI choices and apply saved preference, else English when available.
 */
export function applyInitialAudioTrackSelection(video, savedTrackKey) {
  const tracks = video?.audioTracks;
  if (!tracks?.length) {
    return { choices: [], activeKey: '' };
  }

  const choices = collectAudioTrackChoices(tracks);
  let activeKey = choices[0]?.key || '';

  if (tracks.length >= 2) {
    let target = findAudioTrackByKey(tracks, savedTrackKey);
    const fromSaved = Boolean(target);
    if (!target) {
      for (let i = 0; i < tracks.length; i += 1) {
        if (isEnglishAudioLanguage(tracks[i].language)) {
          target = tracks[i];
          break;
        }
      }
    }
    if (target) {
      enableOnlyAudioTrack(tracks, target);
      for (let i = 0; i < tracks.length; i += 1) {
        if (tracks[i] === target) {
          activeKey = audioTrackKey(target, i);
          break;
        }
      }
      streamDebug('video', 'initial audio track', {
        activeKey,
        language: target.language,
        fromSaved,
      });
    } else {
      for (let i = 0; i < tracks.length; i += 1) {
        if (tracks[i].enabled) {
          activeKey = audioTrackKey(tracks[i], i);
          break;
        }
      }
    }
  }

  return { choices, activeKey };
}

export function selectAudioTrackByKey(video, trackKey) {
  const tracks = video?.audioTracks;
  const track = findAudioTrackByKey(tracks, trackKey);
  if (!track) return false;
  enableOnlyAudioTrack(tracks, track);
  streamDebug('video', 'select audio track', { trackKey, language: track.language });
  return true;
}