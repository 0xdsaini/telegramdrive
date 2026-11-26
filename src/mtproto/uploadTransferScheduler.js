/**
 * Web K apiFileManager.downloadCheck-style upload queue (activeDelta limits in-flight bytes).
 * @see Telegram-web-k src/lib/appManagers/apiFileManager.ts
 */

export const MIN_PART_SIZE = 64 * 1024;

/** ~9 × 512 KiB streams in flight (non-premium), same ratio as Web K REGULAR_DOWNLOAD_DELTA */
export const REGULAR_UPLOAD_ACTIVE_LIMIT =
  Math.floor((9 * 512 * 1024) / MIN_PART_SIZE);

/** Premium ceiling from Web K PREMIUM_DOWNLOAD_DELTA */
export const PREMIUM_UPLOAD_ACTIVE_LIMIT =
  Math.floor((56 * 512 * 1024) / MIN_PART_SIZE);

export function partActiveDelta(partSizeBytes) {
  return Math.max(1, Math.ceil(partSizeBytes / MIN_PART_SIZE));
}

export function createUploadTransferScheduler(activeLimit = REGULAR_UPLOAD_ACTIVE_LIMIT) {
  let activeDelta = 0;
  /** @type {Array<{ activeDelta: number, run: () => Promise<void>, resolve: Function, reject: Function }>} */
  const queue = [];

  function pump() {
    while (queue.length > 0 && activeDelta < activeLimit) {
      const item = queue.shift();
      activeDelta += item.activeDelta;
      Promise.resolve()
        .then(() => item.run())
        .then(
          () => item.resolve(),
          (err) => item.reject(err),
        )
        .finally(() => {
          activeDelta -= item.activeDelta;
          pump();
        });
    }
  }

  /**
   * @param {number} delta
   * @param {() => Promise<void>} run
   */
  function schedule(delta, run) {
    return new Promise((resolve, reject) => {
      queue.push({ activeDelta: delta, run, resolve, reject });
      pump();
    });
  }

  return { schedule, get queued() { return queue.length; }, get active() { return activeDelta; } };
}