import { Api } from 'telegram';
import { utils } from 'telegram';
import { uploadBrowserFileMtproto } from './uploadFileMtproto';

/**
 * Replace a message document using the fast parallel uploader.
 * @param {import('telegram').TelegramClient} gram
 * @param {number} chatId
 * @param {number} messageId
 * @param {File} file
 * @param {{ caption?: string, uploadSession?: object, prefetchBuffer?: ArrayBuffer | null }} [opts]
 */
export async function editDocumentMessageMtproto(gram, chatId, messageId, file, opts = {}) {
  const { caption = '', uploadSession, prefetchBuffer } = opts;

  const fileHandle = await uploadBrowserFileMtproto(gram, file, {
    fileName: file.name,
    uploadSession,
    prefetchBuffer,
  });
  const { mimeType, attrs } = utils.getAttributes(file, { forceDocument: true });

  const media = new Api.InputMediaUploadedDocument({
    file: fileHandle,
    mimeType,
    attributes: attrs,
    forceFile: true,
  });

  const entity = await gram.getInputEntity(chatId);
  const request = new Api.messages.EditMessage({
    peer: entity,
    id: messageId,
    message: caption,
    media,
  });

  await gram.invoke(request);
}