import { getAppOriginPathPrefix } from './appBasePath';
import { streamDebug } from './streamDebug';

/**
 * Same URL shape as Telegram Web K: `stream/{encodeURIComponent(JSON.stringify(info))}`.
 */
export function getStreamUrl({ fileId, size, mimeType, fileName, messageId, chatId }) {
  const info = {
    fileId,
    size,
    mimeType,
    fileName,
    backend: 'mtproto',
    messageId,
    chatId,
  };
  const encoded = encodeURIComponent(JSON.stringify(info));
  const url = `${getAppOriginPathPrefix()}/stream/${encoded}`;
  streamDebug('url', 'getStreamUrl', { fileId: info.fileId, size: info.size, url });
  return url;
}

export function isStreamUrl(url) {
  return typeof url === 'string' && url.includes('/stream/');
}

export function parseStreamUrlInfo(url) {
  if (!url || typeof url !== 'string') {
    return null;
  }
  const needle = '/stream/';
  const index = url.indexOf(needle);
  if (index === -1) {
    return null;
  }
  try {
    const params = url.slice(index + needle.length).split('?')[0];
    return JSON.parse(decodeURIComponent(params));
  } catch {
    return null;
  }
}

/** Opens a progressive-stream URL in a new tab (native video element; SW serves bytes). */
export function openStreamUrlInNewTab(streamUrl) {
  if (typeof window === 'undefined' || !streamUrl || !isStreamUrl(streamUrl)) {
    return false;
  }
  const href = streamUrl.startsWith('http')
    ? streamUrl
    : new URL(streamUrl, window.location.origin).href;
  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  return Boolean(opened);
}