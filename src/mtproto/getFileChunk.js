import bigInt from 'big-integer';
import { Api } from 'telegram';

export const MIN_CHUNK_SIZE = 4096;
export const MAX_CHUNK_SIZE = 512 * 1024;
export const ONE_MB = 1024 * 1024;

/**
 * GramJS/Telegram only accepts upload.GetFile limits between 4 KiB and 512 KiB
 * (multiples of 4 KiB). Smaller reads use `precise: true` (telegram-tt).
 */
export function maxGetFileLimitAtOffset(offset) {
  let cap = MAX_CHUNK_SIZE;
  const inMbRemainder = offset % ONE_MB;
  if (inMbRemainder !== 0) {
    cap = Math.min(cap, ONE_MB - inMbRemainder);
  }
  // Second half of each 1 MiB DC window: empirically max 256 KiB per request.
  if (inMbRemainder >= MAX_CHUNK_SIZE) {
    cap = Math.min(cap, MAX_CHUNK_SIZE / 2);
  }
  return Math.max(MIN_CHUNK_SIZE, cap - (cap % MIN_CHUNK_SIZE));
}

export function normalizeGetFileLimit(offset, requestedLimit, fileSize) {
  const remaining = fileSize ? Math.max(0, fileSize - offset) : requestedLimit;
  let limit = Math.min(requestedLimit, remaining || requestedLimit);
  limit = Math.min(limit, maxGetFileLimitAtOffset(offset));

  if (limit < MIN_CHUNK_SIZE) {
    limit = MIN_CHUNK_SIZE;
  }

  limit -= limit % MIN_CHUNK_SIZE;
  if (limit < MIN_CHUNK_SIZE) {
    limit = MIN_CHUNK_SIZE;
  }

  return planGetFileRequest(offset, limit, fileSize);
}

/**
 * Telegram Web A (telegram-tt) upload.getFile offset/limit rules.
 */
export function planGetFileRequest(offset, limit, fileSize) {
  let outLimit = limit;
  let precise = false;

  if (fileSize != null && offset + outLimit > fileSize) {
    precise = true;
  }

  if (Math.floor(offset / ONE_MB) !== Math.floor((offset + outLimit - 1) / ONE_MB)) {
    outLimit = ONE_MB - (offset % ONE_MB);
    precise = true;
  }

  if (offset % MIN_CHUNK_SIZE !== 0 || outLimit % MIN_CHUNK_SIZE !== 0) {
    precise = true;
  }

  return { offset, limit: outLimit, precise };
}

export function buildGetFile(location, offset, limit, precise) {
  return new Api.upload.GetFile({
    location,
    offset: bigInt(offset),
    limit,
    precise: precise || undefined,
  });
}