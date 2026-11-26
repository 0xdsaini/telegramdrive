/** Telegram Web A/K: parallel file workers (src/config.ts, apiFileManager activeDelta pipeline) */
export const DOWNLOAD_WORKERS = 16;
export const UPLOAD_WORKERS = 16;

/**
 * Run async tasks with a fixed worker pool (telegram-tt GramJS downloadMedia workers).
 */
export async function runWithWorkerPool(items, fn, workers = DOWNLOAD_WORKERS) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  const poolSize = Math.min(workers, items.length);

  async function drain() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: poolSize }, () => drain()));
  return results;
}