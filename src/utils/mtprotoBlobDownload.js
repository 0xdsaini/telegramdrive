import { DOWNLOAD_WORKERS, runWithWorkerPool } from '../mtproto/downloadConcurrency';

const READ_CHUNK = 1024 * 1024;

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