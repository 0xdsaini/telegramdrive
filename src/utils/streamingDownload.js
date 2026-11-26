import { getAppOriginPathPrefix } from './appBasePath';
import { mimeTypeFromFileName } from './mimeTypes';
import { prepareForStreaming, isStreamServiceWorkerControlling } from './streamBridge';
import { streamDebug, streamDebugError } from './streamDebug';
import { requestMtprotoFilePart } from '../mtproto/requestFilePartMtproto';
import { requestTdlibFilePart } from './tdlibFilePartReader';
import { DOWNLOAD_WORKERS, runWithWorkerPool } from '../mtproto/downloadConcurrency';
import { downloadTelegramFileAsBlob, triggerBrowserFileDownload } from './downloadTelegramFile';

const PART_SIZE = 512 * 1024;

function rfc5987Encode(fileName) {
  return encodeURIComponent(fileName).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildContentDisposition(fileName) {
  const asciiFileName = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '\\$&');
  return `attachment; filename="${asciiFileName}"; filename*=UTF-8''${rfc5987Encode(fileName)}`;
}

function postToServiceWorker(message, transfer = []) {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) {
    throw new Error('Stream worker is not controlling this tab');
  }
  controller.postMessage(message, transfer);
}

function waitForDownloadHandshake(downloadId, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', onMessage);
      reject(new Error('Download handshake timed out'));
    }, timeoutMs);

    const onMessage = (event) => {
      if (
        event.data?.type === 'SW_DOWNLOAD_REQUEST_RECEIVED'
        && String(event.data.id) === String(downloadId)
      ) {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener('message', onMessage);
        resolve();
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
  });
}

async function fetchPart(client, fileId, size, offset, limit, messageId, chatId) {
  if (client?._gram) {
    return requestMtprotoFilePart(client._gram, fileId, size, offset, limit, {
      messageId,
      chatId,
    });
  }
  return requestTdlibFilePart(client, fileId, size, offset, limit);
}

/**
 * Pipe Telegram file parts into the service worker download stream (WebK-style disc save).
 */
async function pipePartsToServiceWorker(
  client,
  { fileId, size, messageId, chatId },
  downloadId,
  onProgress,
) {
  const parts = [];
  for (let offset = 0; offset < size; offset += PART_SIZE) {
    parts.push({
      index: parts.length,
      offset,
      limit: Math.min(PART_SIZE, size - offset),
    });
  }

  const pending = new Map();
  let nextIndex = 0;
  let bytesDone = 0;
  let drainChain = Promise.resolve();

  const drainInOrder = () => {
    drainChain = drainChain.then(async () => {
      while (pending.has(nextIndex)) {
        const bytes = pending.get(nextIndex);
        pending.delete(nextIndex);
        const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        postToServiceWorker(
          { type: 'SW_DOWNLOAD_CHUNK', id: downloadId, bytes: buffer },
          [buffer],
        );
        bytesDone += bytes.byteLength;
        if (onProgress && size > 0) {
          onProgress(Math.min(99, Math.round((bytesDone / size) * 100)));
        }
        nextIndex += 1;
      }
    });
    return drainChain;
  };

  await runWithWorkerPool(
    parts,
    async (part) => {
      const bytes = await fetchPart(
        client,
        fileId,
        size,
        part.offset,
        part.limit,
        messageId,
        chatId,
      );
      if (!bytes?.byteLength) {
        throw new Error(`Empty part at offset ${part.offset}`);
      }
      pending.set(part.index, bytes);
      await drainInOrder();
    },
    DOWNLOAD_WORKERS,
  );

  await drainChain;
  if (nextIndex !== parts.length) {
    throw new Error('Download ended before all parts were written');
  }
}

/**
 * Start a browser-native download immediately while bytes stream through the SW (Telegram Web K).
 */
export async function streamingDownloadToDisc(
  client,
  { fileId, size, fileName, mimeType, messageId, chatId },
  { onProgress } = {},
) {
  if (!client?.send) {
    throw new Error('Telegram client is not ready');
  }
  if (fileId == null || !size) {
    throw new Error('Missing file id or size');
  }

  const type = mimeType || mimeTypeFromFileName(fileName);
  await prepareForStreaming(client, {
    allowReload: false,
    timeoutMs: 12_000,
    skipTdlibProbe: !!client?._gram,
  });

  if (!isStreamServiceWorkerControlling()) {
    throw new Error('STREAM_SW_UNAVAILABLE');
  }

  const downloadId = `${(Math.random() * 0x7fffffff) | 0}`;
  const headers = {
    'Content-Type': type,
    'Content-Disposition': buildContentDisposition(fileName),
    'Content-Length': String(size),
  };

  streamDebug('download', 'SW_DOWNLOAD_START', { downloadId, fileName, size });

  const handshake = waitForDownloadHandshake(downloadId);
  postToServiceWorker({ type: 'SW_DOWNLOAD_START', id: downloadId, headers });

  const base = getAppOriginPathPrefix();
  const iframe = document.createElement('iframe');
  iframe.hidden = true;
  iframe.src = `${base}/d/${downloadId}`;
  document.body.appendChild(iframe);

  try {
    await handshake;
    await pipePartsToServiceWorker(
      client,
      { fileId, size, messageId, chatId },
      downloadId,
      onProgress,
    );
    postToServiceWorker({ type: 'SW_DOWNLOAD_FINALIZE', id: downloadId });
    onProgress?.(100);
    streamDebug('download', 'complete', { downloadId, fileName });
  } catch (error) {
    streamDebugError('download', 'failed', error);
    try {
      postToServiceWorker({ type: 'SW_DOWNLOAD_CANCEL', id: downloadId });
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    setTimeout(() => {
      iframe.remove();
    }, 1500);
  }
}

/**
 * Prefer SW streaming; fall back to in-memory blob + anchor when the worker is unavailable.
 */
export async function downloadTelegramFileWithStreaming(
  client,
  fileParams,
  { onProgress } = {},
) {
  try {
    await streamingDownloadToDisc(client, fileParams, { onProgress });
  } catch (error) {
    if (error?.message !== 'STREAM_SW_UNAVAILABLE' && isStreamServiceWorkerControlling()) {
      throw error;
    }
    streamDebug('download', 'fallback to blob', { reason: error?.message });
    const blob = await downloadTelegramFileAsBlob(client, fileParams, { onProgress });
    triggerBrowserFileDownload(blob, fileParams.fileName);
  }
}