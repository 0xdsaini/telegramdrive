import { downloadSmallTelegramFile } from './downloadSmallTelegramFile';
import { resolveTelegramFile } from './telegramFileResolver';
import { streamDebug, streamDebugError } from './streamDebug';
import { srtToVtt } from './siblingSubtitles';

/**
 * @param {*} telegramClient
 * @param {number} chatId
 * @param {{ filename: string, message_id: number }} subtitleEntry
 * @returns {Promise<string>}
 */
export async function loadSidecarSubtitleVtt(telegramClient, chatId, subtitleEntry) {
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
  streamDebug('subtitle', 'load sidecar OK', { filename, byteLength: vtt.length });
  return vtt;
}

/** @deprecated Prefer loadSidecarSubtitleVtt — blob fetch breaks under service worker on desktop */
export async function loadSidecarSubtitleObjectUrl(telegramClient, chatId, subtitleEntry) {
  const vtt = await loadSidecarSubtitleVtt(telegramClient, chatId, subtitleEntry);
  const vttBlob = new Blob([vtt], { type: 'text/vtt' });
  return URL.createObjectURL(vttBlob);
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