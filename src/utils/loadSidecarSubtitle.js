import { downloadSmallTelegramFile } from './downloadSmallTelegramFile';
import { resolveTelegramFile } from './telegramFileResolver';
import { streamDebug, streamDebugError } from './streamDebug';
import { srtToVtt } from './siblingSubtitles';

/**
 * Fetch a same-folder sidecar subtitle and return an object URL for WebVTT.
 * @param {*} telegramClient
 * @param {number} chatId
 * @param {{ filename: string, message_id: number }} subtitleEntry
 * @returns {Promise<string>}
 */
export async function loadSidecarSubtitleObjectUrl(telegramClient, chatId, subtitleEntry) {
  const { filename, message_id: messageId } = subtitleEntry;
  streamDebug('subtitle', 'load sidecar start', { filename, messageId });

  const resolved = await resolveTelegramFile(telegramClient, chatId, filename, messageId);
  const ext = filename.split('.').pop()?.toLowerCase();
  const blob = await downloadSmallTelegramFile(telegramClient, resolved.fileId, {
    mimeType: ext === 'vtt' ? 'text/vtt' : 'text/plain',
    maxWaitMs: 90_000,
    label: `subtitle:${filename}`,
  });

  const raw = await blob.text();
  const vtt = ext === 'vtt' ? raw.replace(/^\uFEFF/, '') : srtToVtt(raw);
  const vttBlob = new Blob([vtt], { type: 'text/vtt' });
  const url = URL.createObjectURL(vttBlob);
  streamDebug('subtitle', 'load sidecar OK', { filename, byteLength: vttBlob.size });
  return url;
}

export function revokeSidecarSubtitleObjectUrl(objectUrl) {
  if (objectUrl && typeof objectUrl === 'string' && objectUrl.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      streamDebugError('subtitle', 'revoke object url', err);
    }
  }
}