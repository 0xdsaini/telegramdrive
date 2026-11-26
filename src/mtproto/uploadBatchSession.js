import {
  createUploadSenderPool,
  pinExportedSender,
  releaseUploadSenderPool,
  UPLOAD_SENDER_COUNT,
} from './uploadSenderPool';
import {
  createUploadTransferScheduler,
  REGULAR_UPLOAD_ACTIVE_LIMIT,
} from './uploadTransferScheduler';

/**
 * Shared MTProto upload session: one scheduler + sender pool for an entire batch.
 * @param {import('telegram').TelegramClient} client
 * @param {{ activeLimit?: number }} [opts]
 */
export async function createUploadBatchSession(client, opts = {}) {
  const dcId = client.session.dcId;
  const activeLimit = opts.activeLimit ?? REGULAR_UPLOAD_ACTIVE_LIMIT;
  const unpin = pinExportedSender(client, dcId);
  const senders = await createUploadSenderPool(client, dcId, UPLOAD_SENDER_COUNT);
  return {
    client,
    dcId,
    activeLimit,
    scheduler: createUploadTransferScheduler(activeLimit),
    senders,
    unpin,
    closed: false,
  };
}

/**
 * @param {Awaited<ReturnType<typeof createUploadBatchSession>>} session
 */
export async function closeUploadBatchSession(session) {
  if (!session || session.closed) {
    return;
  }
  session.closed = true;
  try {
    session.unpin?.();
  } catch (_) {
    /* ignore */
  }
  await releaseUploadSenderPool(session.senders);
}