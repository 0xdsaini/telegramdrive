import { findParsedVttCueAtTime, parseWebVttCues } from './parseWebVttCues';
import { srtToVtt } from './siblingSubtitles';

describe('parseWebVttCues', () => {
  it('parses cues converted from srt', () => {
    const vtt = srtToVtt(`1
00:00:01,000 --> 00:00:03,000
First line
Second line`);
    const cues = parseWebVttCues(vtt);
    expect(cues).toHaveLength(1);
    expect(cues[0].startTime).toBeCloseTo(1);
    expect(cues[0].endTime).toBeCloseTo(3);
    expect(cues[0].text).toContain('First line');
  });

  it('finds active cue at time', () => {
    const cues = parseWebVttCues(`WEBVTT

00:00:05.000 --> 00:00:07.000
Hi`);
    expect(findParsedVttCueAtTime(cues, 5.5)?.text).toBe('Hi');
    expect(findParsedVttCueAtTime(cues, 2)).toBeNull();
  });
});