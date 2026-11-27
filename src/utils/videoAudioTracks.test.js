import {
  audioTrackKey,
  formatAudioTrackLabel,
  isEnglishAudioLanguage,
  findAudioTrackByKey,
} from './videoAudioTracks';

describe('videoAudioTracks', () => {
  test('isEnglishAudioLanguage', () => {
    expect(isEnglishAudioLanguage('eng')).toBe(true);
    expect(isEnglishAudioLanguage('en-US')).toBe(true);
    expect(isEnglishAudioLanguage('hin')).toBe(false);
  });

  test('formatAudioTrackLabel prefers label then language map', () => {
    expect(formatAudioTrackLabel({ label: ' Director commentary ', language: 'eng' }, 0)).toBe(
      'Director commentary'
    );
    expect(formatAudioTrackLabel({ language: 'hin' }, 1)).toBe('Hindi');
    expect(formatAudioTrackLabel({ language: 'und' }, 2)).toBe('Audio 3');
  });

  test('audioTrackKey and findAudioTrackByKey', () => {
    const tracks = [{ id: 'a1', language: 'eng' }, { language: 'hin' }];
    expect(audioTrackKey(tracks[0], 0)).toBe('a1');
    expect(audioTrackKey(tracks[1], 1)).toBe('hin:1');
    expect(findAudioTrackByKey(tracks, 'hin:1')).toBe(tracks[1]);
  });
});