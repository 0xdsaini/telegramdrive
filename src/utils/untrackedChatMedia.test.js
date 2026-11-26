import {
  messageHasPlayableFileContent,
  messageMatchesRequestedFile,
} from './untrackedChatMedia';

describe('messageMatchesRequestedFile', () => {
  it('matches when Telegram replaces dots with underscores', () => {
    const localName = 'Emily.In.Paris.S03E10.Charade.720p.10Bit.Hindi.English.Esubs.Mov';
    const telegramName = 'Emily_In_Paris_S03E10_Charade_720p_10Bit_Hindi_English_Esubs_Mov';
    const message = {
      id: 42,
      content: {
        '@type': 'messageDocument',
        document: { file_name: telegramName },
      },
    };
    expect(messageMatchesRequestedFile(message, localName)).toBe(true);
  });

  it('rejects unrelated names even after Telegram normalization', () => {
    const message = {
      content: {
        '@type': 'messageDocument',
        document: { file_name: 'other_file_mkv' },
      },
    };
    expect(messageMatchesRequestedFile(message, 'my.movie.mkv')).toBe(false);
  });
});

describe('messageHasPlayableFileContent', () => {
  it('accepts document messages', () => {
    expect(
      messageHasPlayableFileContent({
        content: { '@type': 'messageDocument' },
      }),
    ).toBe(true);
  });

  it('rejects plain text', () => {
    expect(
      messageHasPlayableFileContent({
        content: { '@type': 'messageText' },
      }),
    ).toBe(false);
  });
});