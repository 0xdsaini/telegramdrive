import { bytesFromReadFilePart } from './readFilePartBytes';
import { streamDebug, streamDebugError } from './streamDebug';

const POLL_MS = 200;
const MIN_WAIT_MS = 90_000;
const MAX_WAIT_MS = 300_000;
const PRIORITY_PLAYBACK = 32;
const PRIORITY_PRELOAD = 8;
/** tdweb/TDLib fetches in 512 KiB steps — do not pass larger limits to downloadFile. */
const TDLIB_PART_BYTES = 512 * 1024;

const inFlightParts = new Map();
/** TDLib allows only one active downloadFile per file — serialize all work by fileId. */
const fileDownloadChains = new Map();

function waitMsForByteCount(count) {
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, (count / (1024 * 1024)) * 45_000));
}

function tdlibErrorMessage(error) {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error.message) return String(error.message);
  return String(error);
}

function isCanceledDownloadError(error) {
  const msg = tdlibErrorMessage(error);
  return /canceled|cancelled|Canceled by another downloadFile/i.test(msg);
}

function toError(error) {
  if (error instanceof Error) return error;
  const msg = tdlibErrorMessage(error) || 'TDLib request failed';
  return new Error(msg);
}

function runWithFileDownloadLock(fileId, task) {
  const prev = fileDownloadChains.get(fileId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(task);
  fileDownloadChains.set(fileId, run);
  return run.finally(() => {
    if (fileDownloadChains.get(fileId) === run) {
      fileDownloadChains.delete(fileId);
    }
  });
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

async function waitForContiguousBytes(
  client,
  fileId,
  offset,
  neededSize,
  { priority = PRIORITY_PLAYBACK, allowNudge = true } = {}
) {
  const deadline = Date.now() + waitMsForByteCount(neededSize);
  let polls = 0;
  let lastPrefix = -1;
  let stallTicks = 0;

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

    if (prefix === lastPrefix) {
      stallTicks += 1;
      if (allowNudge && stallTicks >= 8 && file?.local?.is_downloading_active) {
        const chunk = Math.min(neededSize - prefix, TDLIB_PART_BYTES);
        if (chunk > 0) {
          streamDebug('tdlib', 'stall nudge downloadFile', { fileId, offset, prefix, neededSize, chunk });
          await requestRangeDownload(client, fileId, offset + prefix, chunk, {
            synchronous: false,
            priority,
          });
        }
        stallTicks = 0;
      }
    } else {
      stallTicks = 0;
      lastPrefix = prefix;
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

async function requestRangeDownloadOnce(client, fileId, offset, count, { synchronous = false, priority = PRIORITY_PLAYBACK } = {}) {
  streamDebug('tdlib', 'downloadFile', { fileId, offset, limit: count, synchronous, priority });
  const downloadResult = await client.send({
    '@type': 'downloadFile',
    file_id: fileId,
    priority,
    offset,
    limit: count,
    synchronous,
  });
  if (downloadResult?.['@type'] === 'error') {
    throw downloadResult;
  }
  return downloadResult;
}

async function requestRangeDownload(client, fileId, offset, count, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return await requestRangeDownloadOnce(client, fileId, offset, count, options);
    } catch (error) {
      lastError = error;
      if (!isCanceledDownloadError(error) || attempt >= 6) {
        throw toError(error);
      }
      streamDebug('tdlib', 'downloadFile canceled — retry', { attempt, offset, count });
      await new Promise((r) => setTimeout(r, 120 * attempt));
    }
  }
  throw toError(lastError);
}

async function ensureRangeDownloaded(client, fileId, offset, count, { priority = PRIORITY_PLAYBACK } = {}) {
  let prefix = await getDownloadedPrefixSize(client, fileId, offset);
  if (prefix >= count) {
    streamDebug('tdlib', 'range already local', { fileId, offset, count, existing: prefix });
    return;
  }

  while (prefix < count) {
    const remaining = count - prefix;
    const partLimit = Math.min(remaining, TDLIB_PART_BYTES);
    streamDebug('tdlib', 'ensureRangeDownloaded step', {
      fileId,
      offset,
      prefix,
      count,
      partLimit,
    });

    await requestRangeDownload(client, fileId, offset + prefix, partLimit, {
      synchronous: false,
      priority,
    });
    await waitForContiguousBytes(client, fileId, offset, prefix + partLimit, {
      priority,
      allowNudge: true,
    });

    const next = await getDownloadedPrefixSize(client, fileId, offset);
    if (next <= prefix) {
      await requestRangeDownload(client, fileId, offset + prefix, partLimit, {
        synchronous: true,
        priority,
      });
      await waitForContiguousBytes(client, fileId, offset, prefix + partLimit, {
        priority,
        allowNudge: false,
      });
      const afterSync = await getDownloadedPrefixSize(client, fileId, offset);
      if (afterSync <= prefix) {
        throw new Error(`Download stalled at ${prefix} (need ${count} from offset ${offset})`);
      }
      prefix = afterSync;
    } else {
      prefix = next;
    }
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

async function readFilePartWithRetry(client, fileId, offset, count, { priority = PRIORITY_PLAYBACK } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await client.send({ '@type': 'getFile', file_id: fileId });
      if (attempt > 1) {
        await ensureRangeDownloaded(client, fileId, offset, count, { priority });
      }
      return await readFilePartOnce(client, fileId, offset, count);
    } catch (error) {
      lastError = error;
      const msg = tdlibErrorMessage(error);
      streamDebugError('tdlib', `readFilePart attempt ${attempt} failed`, error);
      if (!/not loaded|not loaded yet|canceled|cancelled/i.test(msg) && attempt >= 2) {
        throw toError(error);
      }
      await ensureRangeDownloaded(client, fileId, offset, count, { priority });
    }
  }
  throw toError(lastError);
}

async function fetchFilePartLocked(client, fileId, fileSize, offset, limit, priority) {
  const safeEnd = Math.min(offset + limit, fileSize || offset + limit);
  const count = safeEnd - offset;
  streamDebug('tdlib', 'requestTdlibFilePart begin', {
    fileId,
    fileSize,
    offset,
    limit,
    count,
    priority,
  });

  if (count <= 0) {
    return new Uint8Array(0);
  }

  return runWithFileDownloadLock(fileId, async () => {
    const prefix = await getDownloadedPrefixSize(client, fileId, offset);
    if (prefix < count) {
      await ensureRangeDownloaded(client, fileId, offset, count, { priority });
    }
    const bytes = await readFilePartWithRetry(client, fileId, offset, count, { priority });
    streamDebug('tdlib', 'requestTdlibFilePart done', { byteLength: bytes.byteLength, priority });
    return bytes;
  });
}

/**
 * TDLib equivalent of Telegram Web K's requestFilePart (via upload.getFile).
 */
export async function requestTdlibFilePart(
  client,
  fileId,
  fileSize,
  offset,
  limit,
  { fromPreload = false, _retry = 0 } = {}
) {
  const priority = fromPreload ? PRIORITY_PRELOAD : PRIORITY_PLAYBACK;

  if (fromPreload) {
    return new Uint8Array(0);
  }

  const taskKey = `${fileId}:${offset}:${limit}`;
  if (inFlightParts.has(taskKey)) {
    streamDebug('tdlib', 'requestTdlibFilePart dedupe', { taskKey });
    return inFlightParts.get(taskKey);
  }

  const promise = fetchFilePartLocked(client, fileId, fileSize, offset, limit, priority);

  inFlightParts.set(taskKey, promise);
  try {
    return await promise;
  } catch (error) {
    streamDebugError('tdlib', 'requestTdlibFilePart failed', error);
    if (isCanceledDownloadError(error) && _retry < 3) {
      await new Promise((r) => setTimeout(r, 250 * (_retry + 1)));
      return requestTdlibFilePart(client, fileId, fileSize, offset, limit, {
        fromPreload: false,
        _retry: _retry + 1,
      });
    }
    throw toError(error);
  } finally {
    inFlightParts.delete(taskKey);
  }
}

/**
 * Legacy hook from older bundles — must NOT cancel downloads (breaks seek).
 */
export function prioritizeStreamingDownloads(client, fileId) {
  streamDebug('tdlib', 'prioritizeStreamingDownloads (noop)', { fileId, hasClient: !!client });
}

export function cancelTdlibFilePartRequests(fileId) {
  streamDebug('tdlib', 'cancelTdlibFilePartRequests', { fileId });
  for (const key of inFlightParts.keys()) {
    if (key.startsWith(`${fileId}:`)) {
      inFlightParts.delete(key);
    }
  }
}

export async function cancelTdlibFileDownloads(client, fileId) {
  cancelTdlibFilePartRequests(fileId);
  if (!client) return;
  try {
    await client.send({
      '@type': 'cancelDownloadFile',
      file_id: fileId,
      only_if_pending: true,
    });
    streamDebug('tdlib', 'cancelDownloadFile (pending only)', { fileId });
  } catch (error) {
    streamDebugError('tdlib', 'cancelDownloadFile failed', error);
  }
}