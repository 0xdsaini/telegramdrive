import { bytesFromReadFilePart } from './readFilePartBytes';

/**
 * Download a small TDLib file (e.g. video thumbnail) into a Blob.
 */
export async function downloadSmallTelegramFile(client, fileId, { mimeType = 'image/jpeg', maxWaitMs = 25000 } = {}) {
  const start = await client.send({
    '@type': 'downloadFile',
    file_id: fileId,
    priority: 22,
    offset: 0,
    limit: 0,
    synchronous: false,
  });

  if (start?.['@type'] === 'error') {
    throw new Error(start.message || 'downloadFile failed');
  }

  const deadline = Date.now() + maxWaitMs;
  let lastInfo = null;

  while (Date.now() < deadline) {
    const info = await client.send({
      '@type': 'getFile',
      file_id: fileId,
    });

    if (info?.['@type'] === 'error') {
      throw new Error(info.message || 'getFile failed');
    }

    lastInfo = info;
    const local = info.local || {};
    const size = info.size || 0;

    if (local.is_downloading_completed && size > 0) {
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

    if (
      !local.is_downloading_active
      && size > 0
      && (local.downloaded_size || 0) >= size
    ) {
      const part = await client.send({
        '@type': 'readFilePart',
        file_id: fileId,
        offset: 0,
        count: size,
      });
      if (part?.['@type'] !== 'error') {
        const bytes = await bytesFromReadFilePart(part);
        return new Blob([bytes], { type: mimeType });
      }
    }

    await new Promise((r) => setTimeout(r, 150));
  }

  throw new Error(
    `Thumbnail download timed out (file_id=${fileId}, downloaded=${lastInfo?.local?.downloaded_size ?? 0})`,
  );
}