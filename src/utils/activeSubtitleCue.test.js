import { getActiveSubtitleCueLines } from './activeSubtitleCue';

describe('getActiveSubtitleCueLines', () => {
  it('returns stripped lines from the active hidden track', () => {
    const video = {
      textTracks: [
        {
          kind: 'subtitles',
          mode: 'hidden',
          activeCues: [{ text: 'Hello\n<b>world</b>' }],
        },
      ],
    };
    expect(getActiveSubtitleCueLines(video)).toEqual(['Hello', 'world']);
  });

  it('falls back to cues list when activeCues is empty', () => {
    const video = {
      currentTime: 1,
      textTracks: [
        {
          kind: 'subtitles',
          mode: 'hidden',
          activeCues: [],
          cues: [{ startTime: 0, endTime: 3, text: 'Desktop cue' }],
        },
      ],
    };
    expect(getActiveSubtitleCueLines(video)).toEqual(['Desktop cue']);
  });

  it('limits to two lines', () => {
    const video = {
      textTracks: [
        {
          kind: 'subtitles',
          mode: 'hidden',
          activeCues: [{ text: 'one\ntwo\nthree' }],
        },
      ],
    };
    expect(getActiveSubtitleCueLines(video)).toEqual(['one', 'two']);
  });
});