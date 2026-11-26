import { Api } from 'telegram';
import { utils } from 'telegram';
import { uploadBrowserFileMtproto } from './uploadFileMtproto';
import { registerDocumentFromMessage } from './documentRegistry';

/**
 * Send a document message using parallel MTProto upload (Web K / telegram-tt style).
 * @param {import('telegram').TelegramClient} gram
 * @param {number} chatId
 * @param {File} file
 * @param {{ onProgress?: Function, thumb?: Blob | File | null, workers?: number, uploadSession?: object, prefetchBuffer?: ArrayBuffer | null, thumbPrefetchBuffer?: ArrayBuffer | null }} [opts]
 */
export async function sendDocumentMtproto(gram, chatId, file, opts = {}) {
  const {
    onProgress,
    thumb,
    uploadSession,
    prefetchBuffer,
    thumbPrefetchBuffer,
  } = opts;

  const uploadOpts = {
    onProgress,
    fileName: file.name,
    uploadSession,
    prefetchBuffer,
  };

  const fileHandle = await uploadBrowserFileMtproto(gram, file, uploadOpts);

  let uploadedThumb;
  if (thumb && thumb.size) {
    const thumbFile =
      typeof File !== 'undefined' && thumb instanceof File
        ? thumb
        : new File([thumb], 'thumb.jpg', { type: thumb.type || 'image/jpeg' });
    uploadedThumb = await uploadBrowserFileMtproto(gram, thumbFile, {
      fileName: thumbFile.name,
      uploadSession,
      prefetchBuffer: thumbPrefetchBuffer,
    });
  }

  const { mimeType, attrs } = utils.getAttributes(file, {
    forceDocument: true,
    thumb: thumb || undefined,
  });

  const media = new Api.InputMediaUploadedDocument({
    file: fileHandle,
    mimeType,
    attributes: attrs,
    thumb: uploadedThumb,
    forceFile: true,
  });

  const entity = await gram.getInputEntity(chatId);
  const request = new Api.messages.SendMedia({
    peer: entity,
    media,
    message: '',
  });

  const result = await gram.invoke(request);
  const message = gram._getResponseMessage(request, result, entity);
  if (message?.media?.document) {
    registerDocumentFromMessage(message.media.document, message);
  }
  return message;
}