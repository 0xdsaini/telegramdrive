import { resolveTelegramFile } from './telegramFileResolver';

const documentMessage = (id, fileName, fileId = 9001, size = 1_000_000) => ({
  id,
  content: {
    '@type': 'messageDocument',
    document: {
      file_name: fileName,
      document: { '@type': 'file', id: fileId, size },
    },
  },
});

function mockClient(message, fileSize = message?.content?.document?.document?.size) {
  return {
    async send(req) {
      if (req['@type'] === 'getMessage') {
        return message;
      }
      if (req['@type'] === 'getFile') {
        return { '@type': 'file', id: req.file_id, size: fileSize };
      }
      throw new Error(`unexpected: ${req['@type']}`);
    },
  };
}

describe('resolveTelegramFile', () => {
  it('resolves by message_id even when metadata filename differs from Telegram file_name', async () => {
    const metadataName = 'Emily.In.Paris.S03E10.Mov';
    const telegramName = 'Emily_In_Paris_S03E10_Mov';
    const message = documentMessage(42, telegramName);
    const client = mockClient(message);

    const resolved = await resolveTelegramFile(client, -1001, metadataName, 42);

    expect(resolved.messageId).toBe(42);
    expect(resolved.fileId).toBe(9001);
    expect(resolved.size).toBe(1_000_000);
    expect(resolved.message.content.document.file_name).toBe(telegramName);
  });

  it('throws when message_id is invalid', async () => {
    await expect(resolveTelegramFile(mockClient(null), 1, 'a.mkv', 'nope')).rejects.toThrow(
      /Invalid message_id/,
    );
  });

  it('throws when message has no playable media', async () => {
    const client = mockClient({
      id: 1,
      content: { '@type': 'messageText', text: { text: 'hello' } },
    });
    await expect(resolveTelegramFile(client, 1, 'a.mkv', 1)).rejects.toThrow(
      /no downloadable media/,
    );
  });

  it('throws when getMessage returns nothing', async () => {
    const client = mockClient(null);
    await expect(resolveTelegramFile(client, 1, 'a.mkv', 99)).rejects.toThrow(
      /Could not load Telegram message #99/,
    );
  });
});