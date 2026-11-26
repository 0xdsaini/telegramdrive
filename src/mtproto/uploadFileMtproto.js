import bigInt from 'big-integer';
import { Api, errors } from 'telegram';
import { generateRandomBytes, readBigIntFromBuffer, sleep } from 'telegram/Helpers';
import { getAppropriatedPartSize } from 'telegram/Utils';
import {
  createUploadTransferScheduler,
  partActiveDelta,
  REGULAR_UPLOAD_ACTIVE_LIMIT,
} from './uploadTransferScheduler';
import {
  createUploadSenderPool,
  pinExportedSender,
  releaseUploadSenderPool,
  UPLOAD_SENDER_COUNT,
} from './uploadSenderPool';

const KB_TO_BYTES = 1024;
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024;
const DISCONNECT_SLEEP = 1000;
const UPLOAD_PART_TIMEOUT_MS = 60 * 1000;
const MAX_UPLOAD_ATTEMPTS = 5;

async function invokeUploadPart(client, sender, request) {
  let attempt = 0;
  while (attempt < MAX_UPLOAD_ATTEMPTS) {
    attempt += 1;
    try {
      const result = await Promise.race([
        client.invokeWithSender(request, sender),
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error('UPLOAD_PART_TIMEOUT')),
            UPLOAD_PART_TIMEOUT_MS,
          );
        }),
      ]);
      if (result === false) {
        throw new Error('UPLOAD_PART_FAILED');
      }
      return result;
    } catch (err) {
      if (err instanceof errors.FloodWaitError) {
        await sleep(Math.min(err.seconds, 60) * 1000);
        continue;
      }
      if (
        err?.message === 'UPLOAD_PART_TIMEOUT'
        || (sender && !sender.isConnected())
      ) {
        if (sender?.isConnected?.() && sender.reconnect) {
          try {
            sender.reconnect();
          } catch (_) {
            /* ignore */
          }
        }
        await sleep(DISCONNECT_SLEEP * attempt);
        continue;
      }
      throw err;
    }
  }
  throw new Error('UPLOAD_PART_FAILED');
}

/**
 * Upload a browser File/Blob (Web K pipeline + telegram-tt multi-connection).
 * @param {import('telegram').TelegramClient} client
 * @param {File | Blob} file
 * @param {{ onProgress?: (p: { done: number, total: number, fileName: string, ratio: number }) => void, activeLimit?: number, fileName?: string }} [opts]
 * @returns {Promise<Api.InputFile | Api.InputFileBig>}
 */
export async function uploadBrowserFileMtproto(client, file, opts = {}) {
  const { onProgress, activeLimit = REGULAR_UPLOAD_ACTIVE_LIMIT, fileName: nameOverride } = opts;
  const name =
    nameOverride
    || (typeof File !== 'undefined' && file instanceof File ? file.name : 'file');
  const size = file.size;
  const fileId = readBigIntFromBuffer(generateRandomBytes(8), true, true);
  const isLarge = size > LARGE_FILE_THRESHOLD;
  const partSize = getAppropriatedPartSize(bigInt(size)) * KB_TO_BYTES;
  const partCount = Math.max(1, Math.floor((size + partSize - 1) / partSize));
  const delta = partActiveDelta(partSize);
  const dcId = client.session.dcId;

  const scheduler = createUploadTransferScheduler(activeLimit);
  let completedParts = 0;
  let doneBytes = 0;
  const reportProgress = () => {
    if (!onProgress) return;
    onProgress({
      done: doneBytes,
      total: size,
      fileName: name,
      ratio: size ? doneBytes / size : 1,
    });
  };
  reportProgress();

  const unpin = pinExportedSender(client, dcId);
  const senders = await createUploadSenderPool(client, dcId, UPLOAD_SENDER_COUNT);

  try {
    const partPromises = [];
    for (let partIndex = 0; partIndex < partCount; partIndex++) {
      const begin = partIndex * partSize;
      const end = Math.min(begin + partSize, size);
      const sender = senders[partIndex % senders.length];

      partPromises.push(
        scheduler.schedule(delta, async () => {
          const blobSlice = size === 0 ? file.slice(0, 0) : file.slice(begin, end);
          const bytes = Buffer.from(await blobSlice.arrayBuffer());
          const request = isLarge
            ? new Api.upload.SaveBigFilePart({
                fileId,
                filePart: partIndex,
                fileTotalParts: partCount,
                bytes,
              })
            : new Api.upload.SaveFilePart({
                fileId,
                filePart: partIndex,
                bytes,
              });

          await invokeUploadPart(client, sender, request);
          completedParts += 1;
          doneBytes = Math.min(completedParts * partSize, size);
          reportProgress();
        }),
      );
    }

    await Promise.all(partPromises);
  } finally {
    unpin();
    await releaseUploadSenderPool(senders);
  }

  return isLarge
    ? new Api.InputFileBig({
        id: fileId,
        parts: partCount,
        name,
      })
    : new Api.InputFile({
        id: fileId,
        parts: partCount,
        name,
        md5Checksum: '',
      });
}