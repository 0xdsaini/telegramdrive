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