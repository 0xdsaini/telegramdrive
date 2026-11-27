import {
  applyInitialSubtitleTrackSelection,
  collectSubtitleTrackChoices,
  SIDECAR_SUBTITLE_CHOICE_KEY,
  selectSubtitleTrackByKey,
  SUBTITLE_OFF_KEY,
} from './videoSubtitleTracks';

describe('videoSubtitleTracks', () => {
  it('includes Off and text track labels', () => {
    const textTracks = [
      { kind: 'subtitles', label: 'English', language: 'en', mode: 'disabled' },
      { kind: 'metadata', label: 'x', mode: 'disabled' },
    ];
    const choices = collectSubtitleTrackChoices(textTracks);
    expect(choices[0].key).toBe(SUBTITLE_OFF_KEY);
    expect(choices).toHaveLength(2);
    expect(choices[1].label).toBe('English');
  });

  it('adds sidecar choice when blob url is provided', () => {
    const choices = collectSubtitleTrackChoices([], 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi');
    expect(choices).toHaveLength(2);
    expect(choices[1].key).toBe(SIDECAR_SUBTITLE_CHOICE_KEY);
  });

  it('defaults sidecar on when url is present', () => {
    const video = { textTracks: [] };
    const { activeKey } = applyInitialSubtitleTrackSelection(video, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi');
    expect(activeKey).toBe(SIDECAR_SUBTITLE_CHOICE_KEY);
  });

  it('selects sidecar without text tracks', () => {
    const video = { textTracks: [] };
    expect(selectSubtitleTrackByKey(video, SIDECAR_SUBTITLE_CHOICE_KEY, 'WEBVTT\n\n')).toBe(true);
  });

  it('enables first subtitle when none showing', () => {
    const textTracks = [
      { kind: 'subtitles', label: 'English', language: 'en', mode: 'disabled' },
    ];
    const video = { textTracks };
    const { choices, activeKey } = applyInitialSubtitleTrackSelection(video);
    expect(choices.length).toBeGreaterThan(1);
    expect(textTracks[0].mode).toBe('hidden');
    expect(activeKey).not.toBe(SUBTITLE_OFF_KEY);
  });
});