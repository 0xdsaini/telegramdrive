import { bytesFromReadFilePart } from './readFilePartBytes';
import { streamDebug, streamDebugError } from './streamDebug';

const POLL_MS = 200;
const MIN_WAIT_MS = 60_000;
const MAX_WAIT_MS = 180_000;

const inFlightParts = new Map();

function waitMsForByteCount(count) {
  // Allow at least ~30s per MiB, clamped
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, (count / (1024 * 1024)) * 30_000));
}

function parsePrefixSize(result) {
  if (!result || result['@type'] === 'error') {
    return 0;
  }
  if (result['@type'] === 'fileDownloadedPrefixSize') {
    return result.size ?? 0;
  }
  return result.size ?? result.count ?? 0;
}

async function getDownloadedPrefixSize(client, fileId, offset) {
  const result = await client.send({
    '@type': 'getFileDownloadedPrefixSize',
    file_id: fileId,
    offset,
  });
  const size = parsePrefixSize(result);
  streamDebug('tdlib', 'getFileDownloadedPrefixSize', { fileId, offset, size, result });
  if (result?.['@type'] === 'error') {
    throw new Error(result.message || 'getFileDownloadedPrefixSize failed');
  }
  return size;
}

async function waitForContiguousBytes(client, fileId, offset, neededSize) {
  const deadline = Date.now() + waitMsForByteCount(neededSize);
  let polls = 0;
  while (Date.now() < deadline) {
    polls += 1;
    const prefix = await getDownloadedPrefixSize(client, fileId, offset);
    if (prefix >= neededSize) {
      streamDebug('tdlib', 'waitForContiguousBytes OK', { fileId, offset, neededSize, prefix, polls });
      return prefix;
    }

    const file = await client.send({
      '@type': 'getFile',
      file_id: fileId,
    });

    if (file?.local?.is_downloading_completed) {
      const finalPrefix = await getDownloadedPrefixSize(client, fileId, offset);
      streamDebug('tdlib', 'file complete', { fileId, offset, finalPrefix, neededSize });
      return Math.max(finalPrefix, neededSize);
    }

    if (polls % 10 === 0) {
      streamDebug('tdlib', 'waitForContiguousBytes polling', {
        polls,
        prefix,
        neededSize,
        downloading: file?.local?.is_downloading_active,
        downloaded: file?.local?.downloaded_size,
      });
    }

    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out waiting for ${neededSize} bytes at offset ${offset}`);
}

async function requestRangeDownload(client, fileId, offset, count, { synchronous = false } = {}) {
  streamDebug('tdlib', 'downloadFile', { fileId, offset, limit: count, synchronous });
  const downloadResult = await client.send({
    '@type': 'downloadFile',
    file_id: fileId,
    priority: 32,
    offset,
    limit: count,
    synchronous,
  });
  if (downloadResult?.['@type'] === 'error') {
    throw new Error(downloadResult.message || 'downloadFile failed');
  }
  return downloadResult;
}

async function ensureRangeDownloaded(client, fileId, offset, count) {
  // Always request this exact byte range (TDLib sparse file / tdweb path reads).
  await requestRangeDownload(client, fileId, offset, count, { synchronous: false });
  const prefix = await waitForContiguousBytes(client, fileId, offset, count);
  if (prefix < count) {
    streamDebug('tdlib', 'prefix short after async download — trying synchronous', {
      prefix,
      count,
    });
    await requestRangeDownload(client, fileId, offset, count, { synchronous: true });
    await waitForContiguousBytes(client, fileId, offset, count);
  }
}

async function readFilePartOnce(client, fileId, offset, count) {
  const prefix = await getDownloadedPrefixSize(client, fileId, offset);
  const readCount = Math.min(count, prefix);
  if (readCount <= 0) {
    throw new Error(`Nothing downloaded at offset ${offset}`);
  }

  const readResult = await client.send({
    '@type': 'readFilePart',
    file_id: fileId,
    offset,
    count: readCount,
  });

  streamDebug('tdlib', 'readFilePart', {
    fileId,
    offset,
    requested: count,
    readCount,
    prefix,
    resultType: readResult?.['@type'],
  });

  if (readResult?.['@type'] === 'error') {
    throw new Error(readResult.message || 'readFilePart failed');
  }

  const bytes = await bytesFromReadFilePart(readResult);
  if (readCount < count) {
    streamDebug('tdlib', 'partial read (prefix < chunk)', { readCount, count });
  }
  return bytes;
}

async function readFilePartWithRetry(client, fileId, offset, count) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await client.send({ '@type': 'getFile', file_id: fileId });
      if (attempt > 1) {
        await ensureRangeDownloaded(client, fileId, offset, count);
      }
      return await readFilePartOnce(client, fileId, offset, count);
    } catch (error) {
      lastError = error;
      const msg = String(error?.message || error);
      streamDebugError('tdlib', `readFilePart attempt ${attempt} failed`, error);
      if (!/not loaded|not loaded yet/i.test(msg) && attempt >= 2) {
        throw error;
      }
      await requestRangeDownload(client, fileId, offset, count, { synchronous: true });
      await waitForContiguousBytes(client, fileId, offset, count);
    }
  }
  throw lastError;
}

/**
 * TDLib equivalent of Telegram Web K's requestFilePart (via upload.getFile).
 */
export async function requestTdlibFilePart(client, fileId, fileSize, offset, limit) {
  const taskKey = `${fileId}:${offset}:${limit}`;
  if (inFlightParts.has(taskKey)) {
    streamDebug('tdlib', 'requestTdlibFilePart dedupe', { taskKey });
    return inFlightParts.get(taskKey);
  }

  const promise = (async () => {
    const safeEnd = Math.min(offset + limit, fileSize);
    const count = safeEnd - offset;
    streamDebug('tdlib', 'requestTdlibFilePart begin', { fileId, fileSize, offset, limit, count });

    if (count <= 0) {
      return new Uint8Array(0);
    }

    await ensureRangeDownloaded(client, fileId, offset, count);
    const bytes = await readFilePartWithRetry(client, fileId, offset, count);
    streamDebug('tdlib', 'requestTdlibFilePart done', { byteLength: bytes.byteLength });
    return bytes;
  })();

  inFlightParts.set(taskKey, promise);
  try {
    return await promise;
  } catch (error) {
    streamDebugError('tdlib', 'requestTdlibFilePart failed', error);
    throw error;
  } finally {
    inFlightParts.delete(taskKey);
  }
}

export function cancelTdlibFilePartRequests(fileId) {
  streamDebug('tdlib', 'cancelTdlibFilePartRequests', { fileId });
  for (const key of inFlightParts.keys()) {
    if (key.startsWith(`${fileId}:`)) {
      inFlightParts.delete(key);
    }
  }
}