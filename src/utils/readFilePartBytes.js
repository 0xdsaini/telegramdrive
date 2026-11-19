import { streamDebug, streamDebugError } from './streamDebug';

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function blobToUint8Array(blob) {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Normalize tdweb readFilePart / filePart payloads to Uint8Array.
 */
export async function bytesFromReadFilePart(result) {
  if (!result) {
    throw new Error('Empty readFilePart result');
  }

  const data = result.data;
  if (data instanceof Uint8Array) {
    streamDebug('readFilePart', 'data is Uint8Array', { byteLength: data.byteLength });
    return data;
  }
  if (data instanceof ArrayBuffer) {
    streamDebug('readFilePart', 'data is ArrayBuffer', { byteLength: data.byteLength });
    return new Uint8Array(data);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    streamDebug('readFilePart', 'data is Blob — converting', { size: data.size });
    return blobToUint8Array(data);
  }
  if (data && typeof data === 'object' && typeof data.arrayBuffer === 'function') {
    streamDebug('readFilePart', 'data has arrayBuffer()', { size: data.size });
    return blobToUint8Array(data);
  }
  if (typeof data === 'string') {
    streamDebug('readFilePart', 'decoding string data', { length: data.length });
    try {
      const bytes = base64ToUint8Array(data);
      streamDebug('readFilePart', 'decoded as base64', { byteLength: bytes.byteLength });
      return bytes;
    } catch (e) {
      streamDebug('readFilePart', 'base64 decode failed, using utf-8', { err: String(e) });
      const encoder = new TextEncoder();
      return encoder.encode(data);
    }
  }

  streamDebugError('readFilePart', 'Unsupported data format', {
    dataType: typeof data,
    constructor: data?.constructor?.name,
  });
  throw new Error('Unsupported readFilePart data format');
}