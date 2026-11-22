import { Api } from 'telegram';
import { getDocumentByFileId } from './documentRegistry';
import { streamDebug, streamDebugError } from '../utils/streamDebug';
import { buildGetFile, normalizeGetFileLimit, MIN_CHUNK_SIZE, MAX_CHUNK_SIZE } from './getFileChunk';
import {
  ensureDocumentRegistered,
  isFileReferenceError,
  refreshDocumentFileReference,
} from './refreshDocumentReference';

const inFlightParts = new Map();

function isLimitInvalidError(error) {
  const msg = error?.errorMessage || error?.message || String(error);
  return /LIMIT_INVALID/i.test(msg);
}

async function invokeGetFile(client, dcId, request) {
  let targetDc = dcId || client.session?.dcId;
  let sender = await client.getSender(targetDc);
  try {
    return await client.invokeWithSender(request, sender);
  } catch (error) {
    const dcMatch = error?.errorMessage?.match(/FILE_MIGRATE_(\d+)/);
    if (dcMatch) {
      targetDc = Number(dcMatch[1]);
      sender = await client.getSender(targetDc);
      return client.invokeWithSender(request, sender);
    }
    throw error;
  }
}

async function invokeGetFileOnceRaw(client, doc, offset, reqLimit, precise) {
  const location = new Api.InputDocumentFileLocation({
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize: '',
  });

  const request = buildGetFile(location, offset, reqLimit, precise);
  let result = await invokeGetFile(client, doc.dcId, request);

  if (result instanceof Api.upload.FileCdnRedirect) {
    result = await client.invoke(
      new Api.upload.GetCdnFile({
        fileToken: result.fileToken,
        offset: request.offset,
        limit: request.limit,
      })
    );
  }

  const bytes = result?.bytes;
  if (!bytes || !(bytes.length || bytes.byteLength)) {
    throw new Error('upload.GetFile returned empty');
  }
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

async function invokeGetFileOnce(client, doc, offset, reqLimit, precise) {
  try {
    return await invokeGetFileOnceRaw(client, doc, offset, reqLimit, precise);
  } catch (error) {
    if (!isLimitInvalidError(error) || reqLimit <= MIN_CHUNK_SIZE) {
      throw error;
    }
    let half = Math.floor(reqLimit / 2);
    half -= half % MIN_CHUNK_SIZE;
    if (half < MIN_CHUNK_SIZE) {
      throw error;
    }
    const a = await invokeGetFileOnce(client, doc, offset, half, true);
    const b = await invokeGetFileOnce(client, doc, offset + a.byteLength, reqLimit - half, true);
    const tail = b.subarray(0, Math.max(0, reqLimit - half));
    if (a.byteLength + tail.byteLength === 0) {
      throw error;
    }
    const out = new Uint8Array(a.byteLength + tail.byteLength);
    out.set(a, 0);
    out.set(tail, a.byteLength);
    return out;
  }
}

async function fetchPartBytes(client, doc, offset, limit, fileSize = doc.size) {
  const size = Number(fileSize || doc.size || 0);
  const remainingTotal = size ? Math.max(0, size - offset) : limit;
  if (remainingTotal <= 0 && size) {
    throw new Error(`Invalid read offset=${offset} limit=${limit} size=${size}`);
  }

  const want = Math.min(limit, remainingTotal || limit);
  const parts = [];
  let pos = offset;
  let collected = 0;

  while (collected < want) {
    const left = want - collected;
    const remainingHere = size ? Math.max(0, size - pos) : left;
    const step = Math.min(left, MAX_CHUNK_SIZE, remainingHere || left);
    const { limit: reqLimit, precise } = normalizeGetFileLimit(pos, step, size || undefined);
    const bytes = await invokeGetFileOnce(client, doc, pos, reqLimit, precise);
    if (!bytes.byteLength) {
      break;
    }
    const take = Math.min(bytes.byteLength, left);
    parts.push(bytes.subarray(0, take));
    collected += take;
    pos += take;
    if (take < reqLimit && size && pos >= size) {
      break;
    }
    if (bytes.byteLength < MIN_CHUNK_SIZE && take === bytes.byteLength) {
      break;
    }
  }

  if (!parts.length) {
    throw new Error('upload.GetFile returned no data for range');
  }

  if (parts.length === 1) {
    return parts[0];
  }

  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/**
 * Web A–style byte range via upload.GetFile (GramJS / MTProto).
 */
export async function requestMtprotoFilePart(client, fileId, fileSize, offset, limit, hint = {}) {
  let doc = getDocumentByFileId(fileId);
  if (!doc && hint.chatId && hint.messageId) {
    const registered = await ensureDocumentRegistered(client, hint.chatId, hint.messageId, fileId);
    doc = getDocumentByFileId(fileId) || registered;
  }
  if (!doc) {
    throw new Error(`No MTProto document registered for fileId ${fileId}`);
  }

  if (fileSize) {
    doc.size = fileSize;
  }

  const taskKey = `${fileId}:${offset}:${limit}`;
  if (inFlightParts.has(taskKey)) {
    return inFlightParts.get(taskKey);
  }

  const run = (async () => {
    streamDebug('mtproto', 'upload.GetFile', { fileId, offset, limit, dcId: doc.dcId });

    const attempt = async () => fetchPartBytes(client, doc, offset, limit, fileSize || doc.size);

    try {
      return await attempt();
    } catch (error) {
      if (!isFileReferenceError(error)) {
        throw error;
      }
      streamDebug('mtproto', 'FILE_REFERENCE error — repairing', { fileId });
      const repaired = await refreshDocumentFileReference(client, fileId);
      if (!repaired) {
        throw error;
      }
      doc = getDocumentByFileId(fileId);
      return attempt();
    }
  })();

  inFlightParts.set(taskKey, run);
  try {
    const u8 = await run;
    streamDebug('mtproto', 'upload.GetFile OK', { byteLength: u8.byteLength });
    return u8;
  } catch (error) {
    streamDebugError('mtproto', 'requestMtprotoFilePart failed', error);
    throw error;
  } finally {
    inFlightParts.delete(taskKey);
  }
}

export async function readDocumentPart(client, doc, offset, count) {
  return fetchPartBytes(client, doc, offset, count, doc.size);
}

export function cancelMtprotoFilePartRequests(fileId) {
  for (const key of inFlightParts.keys()) {
    if (key.startsWith(`${fileId}:`)) {
      inFlightParts.delete(key);
    }
  }
}