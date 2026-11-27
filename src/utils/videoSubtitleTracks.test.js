import {
  applyInitialSubtitleTrackSelection,
  collectSubtitleTrackChoices,
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