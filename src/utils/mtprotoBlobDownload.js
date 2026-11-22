import { DOWNLOAD_WORKERS, runWithWorkerPool } from '../mtproto/downloadConcurrency';
import { bytesFromReadFilePart } from './readFilePartBytes';

const READ_CHUNK = 512 * 1024;

/**
 * Download any file id via the TDLib-compat readFilePart shim (16 parallel workers on MTProto).
 */
export async function readFullFileBlob(client, fileId, mimeType = 'application/octet-stream') {
  if (!client?.send) {
    throw new Error('Telegram client not ready');
  }

  const info = await client.send({ '@type': 'getFile', file_id: fileId });
  if (info?.['@type'] === 'error') {
    throw new Error(info.message || 'getFile failed');
  }

  const size = info.size || 0;
  if (size <= 0) {
    throw new Error(`Empty file (file_id=${fileId})`);
  }

  const ranges = [];
  for (let offset = 0; offset < size; offset += READ_CHUNK) {
    ranges.push({ offset, count: Math.min(READ_CHUNK, size - offset) });
  }

  const chunkData = await runWithWorkerPool(ranges, async ({ offset, count }) => {
    const part = await client.send({
      '@type': 'readFilePart',
      file_id: fileId,
      offset,
      count,
    });
    if (part?.['@type'] === 'error') {
      throw new Error(part.message || `readFilePart failed at ${offset}`);
    }
    return bytesFromReadFilePart(part);
  }, DOWNLOAD_WORKERS);

  return new Blob(chunkData, { type: mimeType || info.mime_type || 'application/octet-stream' });
}

/**
 * Full-file download via GramJS upload.GetFile (readFilePart shim), with progress callbacks.
 */
export async function downloadFileViaMtproto(telegramClient, fileInfo, fileName, onProgress) {
  if (!telegramClient?.send) {
    throw new Error('Telegram client not ready');
  }
  if (!fileInfo?.id || !fileInfo.size) {
    throw new Error('Invalid file info for download');
  }

  const fileId = fileInfo.id;
  const size = fileInfo.size;
  const ranges = [];
  for (let offset = 0; offset < size; offset += READ_CHUNK) {
    ranges.push({ offset, count: Math.min(READ_CHUNK, size - offset) });
  }

  let bytesDone = 0;
  const chunkData = await runWithWorkerPool(ranges, async ({ offset, count }) => {
    const part = await telegramClient.send({
      '@type': 'readFilePart',
      file_id: fileId,
      offset,
      count,
    });
    if (!part?.data) {
      throw new Error(`readFilePart returned no data at offset ${offset}`);
    }
    const data =
      part.data instanceof Uint8Array
        ? part.data
        : typeof part.data === 'string'
          ? Buffer.from(part.data, 'base64')
          : Buffer.from(part.data);
    bytesDone += data.byteLength;
    onProgress?.(Math.min(100, Math.round((bytesDone / size) * 100)));
    return data;
  }, DOWNLOAD_WORKERS);

  const blob = new Blob(chunkData, {
    type: fileInfo.mime_type || 'application/octet-stream',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}