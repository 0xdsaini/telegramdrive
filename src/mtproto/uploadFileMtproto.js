import bigInt from 'big-integer';
import { Api, errors } from 'telegram';
import { generateRandomBytes, readBigIntFromBuffer, sleep } from 'telegram/Helpers';
import { getAppropriatedPartSize } from 'telegram/Utils';
import { runWithWorkerPool, UPLOAD_WORKERS } from './downloadConcurrency';

const KB_TO_BYTES = 1024;
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024;
const DISCONNECT_SLEEP = 1000;

/**
 * Upload a browser File/Blob in parallel slices (telegram-tt / Web K style).
 * Never loads the full file into memory.
 * @param {import('telegram').TelegramClient} client
 * @param {File | Blob} file
 * @param {{ onProgress?: (p: { done: number, total: number, fileName: string, ratio: number }) => void, workers?: number, fileName?: string }} [opts]
 * @returns {Promise<Api.InputFile | Api.InputFileBig>}
 */
export async function uploadBrowserFileMtproto(client, file, opts = {}) {
  const { onProgress, workers = UPLOAD_WORKERS, fileName: nameOverride } = opts;
  const name =
    nameOverride
    || (typeof File !== 'undefined' && file instanceof File ? file.name : 'file');
  const size = file.size;
  const fileId = readBigIntFromBuffer(generateRandomBytes(8), true, true);
  const isLarge = size > LARGE_FILE_THRESHOLD;
  const partSize = getAppropriatedPartSize(bigInt(size)) * KB_TO_BYTES;
  const partCount = Math.max(1, Math.floor((size + partSize - 1) / partSize));
  const poolWorkers = Math.min(workers, partCount);

  let completedParts = 0;
  const reportProgress = () => {
    if (!onProgress) return;
    const done = Math.min(completedParts * partSize, size);
    onProgress({
      done,
      total: size,
      fileName: name,
      ratio: size ? done / size : 1,
    });
  };
  reportProgress();

  await client.getSender(client.session.dcId);

  async function uploadPart(partIndex) {
    if (size === 0 && partIndex > 0) {
      return;
    }
    const begin = partIndex * partSize;
    const end = Math.min(begin + partSize, size);
    const blobSlice = size === 0 ? file.slice(0, 0) : file.slice(begin, end);
    const bytesMemo = Buffer.from(await blobSlice.arrayBuffer());

    while (true) {
      let sender;
      try {
        sender = await client.getSender(client.session.dcId);
        await sender.send(
          isLarge
            ? new Api.upload.SaveBigFilePart({
                fileId,
                filePart: partIndex,
                fileTotalParts: partCount,
                bytes: bytesMemo,
              })
            : new Api.upload.SaveFilePart({
                fileId,
                filePart: partIndex,
                bytes: bytesMemo,
              }),
        );
        break;
      } catch (err) {
        if (sender && !sender.isConnected()) {
          await sleep(DISCONNECT_SLEEP);
          continue;
        }
        if (err instanceof errors.FloodWaitError) {
          await sleep(err.seconds * 1000);
          continue;
        }
        throw err;
      }
    }

    completedParts += 1;
    reportProgress();
  }

  const parts = Array.from({ length: partCount }, (_, i) => i);
  await runWithWorkerPool(parts, uploadPart, poolWorkers);

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