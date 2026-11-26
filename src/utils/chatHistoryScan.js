/** Shared paged getChatHistory walk (newest → older). */

export const CHAT_HISTORY_PAGE_SIZE = 50;

/** Default: 40 × 50 = 2000 messages (covers deep metadata/thumbs in busy groups). */
export const CHAT_HISTORY_DEFAULT_MAX_PAGES = 40;

/**
 * @param {object} client
 * @param {number} chatId
 * @param {object} [options]
 * @param {number} [options.maxPages]
 * @param {number} [options.pageSize]
 * @param {(messages: object[]) => boolean|void} [options.onMessages] — return true to stop early
 */
export async function forEachChatHistoryPage(
  client,
  chatId,
  { maxPages = CHAT_HISTORY_DEFAULT_MAX_PAGES, pageSize = CHAT_HISTORY_PAGE_SIZE, onMessages } = {},
) {
  if (!client || !chatId || typeof onMessages !== 'function') {
    return;
  }

  let fromMessageId = 0;

  for (let attempt = 0; attempt < maxPages; attempt += 1) {
    const historyResult = await client.send({
      '@type': 'getChatHistory',
      chat_id: chatId,
      from_message_id: fromMessageId,
      offset: 0,
      limit: pageSize,
      only_local: false,
    });

    const messages = historyResult?.messages ?? [];
    if (!messages.length) {
      break;
    }

    const stop = onMessages(messages);
    if (stop) {
      break;
    }

    if (messages.length < pageSize) {
      break;
    }

    fromMessageId = messages[messages.length - 1].id;
  }
}

/**
 * @param {object} client
 * @param {number} chatId
 * @param {(message: object) => boolean} predicate
 * @param {object} [options]
 * @returns {Promise<object[]>}
 */
export async function collectChatHistoryMatches(client, chatId, predicate, options = {}) {
  const matches = [];
  await forEachChatHistoryPage(client, chatId, {
    ...options,
    onMessages(messages) {
      matches.push(...messages.filter(predicate));
      return false;
    },
  });
  return matches;
}