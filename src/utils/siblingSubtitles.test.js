import {
  fileNameBaseName,
  findSiblingSubtitleFile,
  isSidecarSubtitleFileName,
  srtToVtt,
} from './siblingSubtitles';

describe('siblingSubtitles', () => {
  it('matches same basename srt/vtt in folder', () => {
    const files = [
      { filename: 'Movie.mp4', message_id: 1 },
      { filename: 'Movie.srt', message_id: 2 },
      { filename: 'other.srt', message_id: 3 },
    ];
    const match = findSiblingSubtitleFile(files, 'Movie.mp4');
    expect(match).toEqual({ filename: 'Movie.srt', message_id: 2 });
  });

  it('prefers vtt when both exist', () => {
    const files = [
      { filename: 'x.mkv', message_id: 1 },
      { filename: 'x.srt', message_id: 2 },
      { filename: 'x.vtt', message_id: 3 },
    ];
    const match = findSiblingSubtitleFile(files, 'x.mkv');
    expect(match).toEqual({ filename: 'x.vtt', message_id: 3 });
  });

  it('is case-insensitive on basename', () => {
    const files = [{ filename: 'FOO.srt', message_id: 9 }];
    expect(findSiblingSubtitleFile(files, 'foo.mp4')).toEqual({
      filename: 'FOO.srt',
      message_id: 9,
    });
  });

  it('converts minimal srt to vtt', () => {
    const srt = `1
00:00:01,000 --> 00:00:02,000
Hello

2
00:00:03,000 --> 00:00:04,500
World
`;
    const vtt = srtToVtt(srt);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.000');
    expect(vtt).toContain('Hello');
    expect(vtt).toContain('World');
  });

  it('detects subtitle extensions', () => {
    expect(isSidecarSubtitleFileName('a.srt')).toBe(true);
    expect(isSidecarSubtitleFileName('a.vtt')).toBe(true);
    expect(isSidecarSubtitleFileName('a.mp4')).toBe(false);
    expect(fileNameBaseName('path/foo.bar.mkv')).toBe('path/foo.bar');
  });
});