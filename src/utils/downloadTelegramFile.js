import { downloadSmallTelegramFile } from './downloadSmallTelegramFile';
import { requestTdlibFilePart } from './tdlibFilePartReader';
import { mimeTypeFromFileName } from './mimeTypes';

const LARGE_FILE_CHUNK = 1024 * 1024;
const SMALL_FILE_MAX_BYTES = 50 * 1024 * 1024;

function maxWaitMsForSize(size) {
  if (!size || size <= 0) {
    return 60_000;
  }
  return Math.min(300_000, Math.max(25_000, Math.ceil(size / (512 * 1024)) * 3500));
}

/**
 * Download a TDLib file into a Blob (used for “open/download” of non-streamed files).
 */
export async function downloadTelegramFileAsBlob(
  client,
  { fileId, size, fileName },
  { onProgress } = {},
) {
  if (!client?.send) {
    throw new Error('Telegram client is not ready');
  }
  if (fileId == null) {
    throw new Error('Missing file id');
  }

  const mimeType = mimeTypeFromFileName(fileName);
  const byteCount = size || 0;

  if (byteCount > 0 && byteCount <= SMALL_FILE_MAX_BYTES) {
    return downloadSmallTelegramFile(client, fileId, {
      mimeType,
      maxWaitMs: maxWaitMsForSize(byteCount),
      label: fileName,
    });
  }

  let totalSize = byteCount;
  if (totalSize <= 0) {
    const info = await client.send({ '@type': 'getFile', file_id: fileId });
    if (info?.['@type'] === 'error') {
      throw new Error(info.message || 'getFile failed');
    }
    totalSize = info.size || 0;
  }
  if (totalSize <= 0) {
    throw new Error('Unknown file size');
  }

  const parts = [];
  let offset = 0;
  while (offset < totalSize) {
    const limit = Math.min(LARGE_FILE_CHUNK, totalSize - offset);
    if (onProgress) {
      onProgress(Math.min(99, Math.round((offset / totalSize) * 100)));
    }
    const bytes = await requestTdlibFilePart(client, fileId, totalSize, offset, limit);
    parts.push(bytes);
    offset += bytes.byteLength;
    if (bytes.byteLength === 0) {
      throw new Error(`Download stalled at offset ${offset}`);
    }
  }
  if (onProgress) {
    onProgress(100);
  }
  return new Blob(parts, { type: mimeType });
}

export function triggerBrowserFileDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}