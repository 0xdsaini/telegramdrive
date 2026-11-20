import { bytesFromReadFilePart } from './readFilePartBytes';
import { createThumbsBootTimer } from './thumbsBootstrapDebug';

async function readBlobIfComplete(client, fileId, info, mimeType) {
  const local = info.local || {};
  const size = info.size || 0;
  if (size <= 0) {
    return null;
  }
  const complete =
    (local.is_downloading_completed && size > 0)
    || (!local.is_downloading_active && (local.downloaded_size || 0) >= size);
  if (!complete) {
    return null;
  }
  const part = await client.send({
    '@type': 'readFilePart',
    file_id: fileId,
    offset: 0,
    count: size,
  });
  if (part?.['@type'] === 'error') {
    throw new Error(part.message || 'readFilePart failed');
  }
  const bytes = await bytesFromReadFilePart(part);
  return new Blob([bytes], { type: mimeType });
}

/**
 * Download a small TDLib file (e.g. video thumbnail) into a Blob.
 */
export async function downloadSmallTelegramFile(
  client,
  fileId,
  { mimeType = 'image/jpeg', maxWaitMs = 25_000, label = 'small-file' } = {},
) {
  const done = createThumbsBootTimer(`downloadSmallTelegramFile:${label}`);

  let info = await client.send({
    '@type': 'getFile',
    file_id: fileId,
  });
  if (info?.['@type'] === 'error') {
    throw new Error(info.message || 'getFile failed');
  }

  const cachedBlob = await readBlobIfComplete(client, fileId, info, mimeType);
  if (cachedBlob) {
    done({ fileId, byteLength: cachedBlob.size, path: 'tdlib-local-hit' });
    return cachedBlob;
  }

  const size = info.size || 0;
  const start = await client.send({
    '@type': 'downloadFile',
    file_id: fileId,
    priority: 32,
    offset: 0,
    limit: 0,
    synchronous: size > 0 && size <= 2_000_000,
  });

  if (start?.['@type'] === 'error') {
    throw new Error(start.message || 'downloadFile failed');
  }

  info = start;
  let blob = await readBlobIfComplete(client, fileId, info, mimeType);
  if (blob) {
    done({ fileId, byteLength: blob.size, path: 'download-sync' });
    return blob;
  }

  const deadline = Date.now() + maxWaitMs;
  let lastInfo = info;
  let waitMs = 40;

  while (Date.now() < deadline) {
    info = await client.send({
      '@type': 'getFile',
      file_id: fileId,
    });

    if (info?.['@type'] === 'error') {
      throw new Error(info.message || 'getFile failed');
    }

    lastInfo = info;
    blob = await readBlobIfComplete(client, fileId, info, mimeType);
    if (blob) {
      done({
        fileId,
        byteLength: blob.size,
        path: 'download-poll',
        size: info.size,
      });
      return blob;
    }

    const delay = waitMs;
    await new Promise((r) => setTimeout(r, delay));
    waitMs = Math.min(waitMs + 30, 250);
  }

  done({
    fileId,
    path: 'timeout',
    downloaded: lastInfo?.local?.downloaded_size ?? 0,
    expected: lastInfo?.size ?? 0,
  });
  throw new Error(
    `Thumbnail download timed out (file_id=${fileId}, downloaded=${lastInfo?.local?.downloaded_size ?? 0})`,
  );
}