/** Matches telegram-tt MAX_CONCURRENT_CONNECTIONS (non-premium). */
export const UPLOAD_SENDER_COUNT = 3;

const UPLOAD_PIN_INTERVAL_MS = 12_000;

/**
 * Stop GramJS from disconnecting the shared exported sender mid-upload (30s release timer).
 * @param {import('telegram').TelegramClient} client
 * @param {number} dcId
 * @returns {() => void}
 */
export function pinExportedSender(client, dcId) {
  const clearReleaseTimer = () => {
    const timeouts = client._exportedSenderReleaseTimeouts;
    if (!timeouts) return;
    const handle = timeouts.get(dcId);
    if (handle) {
      clearTimeout(handle);
      timeouts.delete(dcId);
    }
  };

  clearReleaseTimer();
  const intervalId = setInterval(clearReleaseTimer, UPLOAD_PIN_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
    clearReleaseTimer();
  };
}

/**
 * Extra MTProto connections for upload (telegram-tt multi-sender / Web K parallel streams).
 * @param {import('telegram').TelegramClient} client
 * @param {number} dcId
 * @param {number} [count]
 * @returns {Promise<import('telegram/network').MTProtoSender[]>}
 */
export async function createUploadSenderPool(client, dcId, count = UPLOAD_SENDER_COUNT) {
  const senders = [];
  const primary = await client.getSender(dcId);
  senders.push(primary);

  for (let i = 1; i < count; i++) {
    const extra = client._createExportedSender(dcId);
    await client._connectSender(extra, dcId);
    senders.push(extra);
  }

  return senders;
}

/**
 * @param {import('telegram/network').MTProtoSender[]} senders
 * @param {import('telegram').TelegramClient} client
 * @param {number} dcId
 */
export async function releaseUploadSenderPool(senders) {
  if (!senders?.length) return;
  for (let i = 1; i < senders.length; i++) {
    try {
      await senders[i].disconnect();
    } catch (_) {
      /* ignore */
    }
  }
}