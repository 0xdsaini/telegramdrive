import { getAppOriginPathPrefix } from './appBasePath';
import { streamDebug } from './streamDebug';

/**
 * Same URL shape as Telegram Web K: `stream/{encodeURIComponent(JSON.stringify(info))}`.
 */
export function getStreamUrl({ fileId, size, mimeType, fileName }) {
  const info = { fileId, size, mimeType, fileName };
  const encoded = encodeURIComponent(JSON.stringify(info));
  const url = `${getAppOriginPathPrefix()}/stream/${encoded}`;
  streamDebug('url', 'getStreamUrl', { fileId: info.fileId, size: info.size, url });
  return url;
}

export function isStreamUrl(url) {
  return typeof url === 'string' && url.includes('/stream/');
}