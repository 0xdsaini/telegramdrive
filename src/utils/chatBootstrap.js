/**
 * Ordered chat boot: (1) metadata.json, (2) thumbs.db, then the rest of the app.
 */

import { loadSqlModule } from './thumbsDbSql';
import { ensureTelegramThumbsStore } from './telegramThumbsStore';
import { createThumbsBootTimer, thumbsBootLog } from './thumbsBootstrapDebug';

/**
 * @param {object} params
 * @param {() => Promise<void>} params.loadMetadata — must finish before thumbs
 * @param {object} params.client — TDLib client
 * @param {number} params.chatId
 */
export async function runChatStorageBootstrap({ loadMetadata, client, chatId }) {
  if (!client || !chatId || typeof loadMetadata !== 'function') {
    return { posterCount: 0 };
  }

  const wasmReady = loadSqlModule().catch((error) => {
    console.warn('sql.js preload failed (will retry with thumbs load):', error);
  });

  const metadataDone = createThumbsBootTimer('chatBootstrap-metadata');
  await loadMetadata();
  metadataDone({ chatId });

  await wasmReady;
  thumbsBootLog('chatBootstrap-thumbs-start', { chatId });
  const thumbsDone = createThumbsBootTimer('chatBootstrap-thumbs');
  const result = await ensureTelegramThumbsStore(client, chatId);
  thumbsDone({ posterCount: result.posterCount, chatId });
  return result;
}