import { Api } from 'telegram';
import { CustomFile } from 'telegram/client/uploads';
import { registerDocumentFromMessage, getDocumentByFileId } from './documentRegistry';
import { cancelMtprotoFilePartRequests, readDocumentPart } from './requestFilePartMtproto';
import { messageToTdlibShape } from './messageContentShape';
import {
  isFileReferenceError,
  refreshDocumentFileReference,
} from './refreshDocumentReference';

function tdlibSearchFilterToGram(filter) {
  const type = filter?.['@type'];
  switch (type) {
    case 'searchMessagesFilterDocument':
      return new Api.InputMessagesFilterDocument();
    case 'searchMessagesFilterVideo':
      return new Api.InputMessagesFilterVideo();
    case 'searchMessagesFilterPhoto':
      return new Api.InputMessagesFilterPhotos();
    default:
      return new Api.InputMessagesFilterEmpty();
  }
}

function inputMessageCaption(input) {
  const caption = input?.caption;
  if (!caption) {
    return '';
  }
  if (typeof caption.text === 'string') {
    return caption.text;
  }
  if (typeof caption.formatted_text?.text === 'string') {
    return caption.formatted_text.text;
  }
  return '';
}

/** GramJS CustomFile must hold a Buffer; TDLib shim passes browser File/Blob in inputFileBlob. */
async function inputBlobToCustomFile(data, name) {
  const fileName = name || 'file';
  let buffer;
  if (data instanceof Blob) {
    buffer = Buffer.from(await data.arrayBuffer());
  } else if (typeof data === 'string') {
    buffer = Buffer.from(data, 'utf8');
  } else if (Buffer.isBuffer(data)) {
    buffer = data;
  } else if (data instanceof ArrayBuffer) {
    buffer = Buffer.from(data);
  } else if (ArrayBuffer.isView(data)) {
    buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  } else if (data != null) {
    buffer = Buffer.from(await new Blob([data]).arrayBuffer());
  } else {
    throw new Error('inputFileBlob: missing document data');
  }
  return new CustomFile(fileName, buffer.length, undefined, buffer);
}

function dialogChatId(dialog) {
  // GramJS `dialog.id` is the marked peer id (e.g. -100…); entity.id alone breaks supergroups.
  const marked = dialog?.id;
  if (marked != null) {
    return typeof marked === 'bigint' ? Number(marked) : marked;
  }
  const entity = dialog?.entity;
  if (!entity?.id) return null;
  const raw = typeof entity.id === 'bigint' ? Number(entity.id) : entity.id;
  if (entity.className === 'Channel' || entity.className === 'ChannelForbidden') {
    return -1_000_000_000_000 - raw;
  }
  return raw;
}

export function createTdlibCompatShim(gram, { apiId, apiHash, saveSession, onAuthReady }) {
  let authorized = false;
  let pendingPhone = '';
  let pendingPhoneCodeHash = '';

  const shim = {
    onUpdate: null,
    /** Underlying GramJS client for MTProto streaming */
    _gram: gram,

    _setAuthorized(value) {
      authorized = value;
    },

    async send(req) {
      if (!req || !req['@type']) {
        throw new Error('Invalid TDLib request');
      }

      switch (req['@type']) {
        case 'setAuthenticationPhoneNumber': {
          pendingPhone = req.phone_number;
          const sent = await gram.sendCode(
            { apiId, apiHash },
            pendingPhone
          );
          pendingPhoneCodeHash = sent.phoneCodeHash;
          return { '@type': 'ok' };
        }

        case 'checkAuthenticationCode': {
          await gram.signInUser(
            { apiId, apiHash },
            {
              phoneNumber: pendingPhone,
              phoneCodeHash: pendingPhoneCodeHash,
              phoneCode: async () => req.code,
            }
          );
          authorized = true;
          saveSession();
          onAuthReady();
          return { '@type': 'ok' };
        }

        case 'getNetworkStatistics':
          return { '@type': 'networkStatistics' };

        case 'logOut': {
          await gram.invoke(new Api.auth.LogOut());
          await gram.disconnect();
          authorized = false;
          return { '@type': 'ok' };
        }

        case 'getChats': {
          const dialogs = await gram.getDialogs({ limit: req.limit || 100 });
          return {
            '@type': 'chats',
            chat_ids: dialogs.map((d) => dialogChatId(d)).filter((id) => id != null),
          };
        }

        case 'getChat': {
          const entity = await gram.getEntity(req.chat_id);
          const title =
            entity.title || entity.firstName || entity.username || `Chat ${req.chat_id}`;
          let typeName = 'chatTypePrivate';
          if (entity.className === 'Channel') {
            typeName = entity.megagroup ? 'chatTypeSupergroup' : 'chatTypeChannel';
          } else if (entity.className === 'Chat') {
            typeName = 'chatTypeBasicGroup';
          }
          return {
            '@type': 'chat',
            id: req.chat_id,
            title,
            type: { '@type': typeName },
          };
        }

        case 'getMessage': {
          const messages = await gram.getMessages(req.chat_id, { ids: [req.message_id] });
          const msg = messages?.[0];
          return messageToTdlibShape(msg);
        }

        case 'searchChatMessages': {
          const filter = tdlibSearchFilterToGram(req.filter);
          const offsetId = req.from_message_id || 0;
          const limit = req.limit || 100;
          const opts = { limit, offsetId };
          const query = typeof req.query === 'string' ? req.query : '';
          if (query) {
            opts.search = query;
          }
          const hasTypedFilter = req.filter?.['@type']
            && req.filter['@type'] !== 'searchMessagesFilterEmpty';
          if (hasTypedFilter || query) {
            opts.filter = filter;
          }
          const msgs = await gram.getMessages(req.chat_id, opts);
          return {
            '@type': 'messages',
            messages: (msgs || []).map(messageToTdlibShape).filter(Boolean),
          };
        }

        case 'getChatHistory': {
          const opts = { limit: req.limit || 50 };
          if (req.from_message_id) {
            opts.offsetId = req.from_message_id;
          }
          const msgs = await gram.getMessages(req.chat_id, opts);
          return {
            '@type': 'messages',
            messages: (msgs || []).map(messageToTdlibShape).filter(Boolean),
          };
        }

        case 'getFile': {
          const doc = getDocumentByFileId(req.file_id);
          const size = doc?.size || 0;
          const ready = Boolean(doc && size > 0);
          return {
            '@type': 'file',
            id: req.file_id,
            size,
            mime_type: doc?.mimeType || undefined,
            local: {
              downloaded_prefix_size: ready ? size : 0,
              downloaded_size: ready ? size : 0,
              is_downloading_completed: ready,
              is_downloading_active: false,
            },
          };
        }

        case 'downloadFile':
        case 'cancelDownloadFile':
          return { '@type': 'file', id: req.file_id };

        case 'readFilePart': {
          let doc = getDocumentByFileId(req.file_id);
          if (!doc) throw new Error('Unknown file_id');
          const want = req.count > 0 ? req.count : doc.size || 1024 * 1024;
          const limit = Math.min(Math.max(want, 1), 1024 * 1024);

          const readOnce = async () => {
            const bytes = await readDocumentPart(gram, doc, req.offset, limit);
            return bytes instanceof Buffer ? bytes : Buffer.from(bytes);
          };

          try {
            const data = await readOnce();
            return { '@type': 'filePart', data };
          } catch (error) {
            if (!isFileReferenceError(error)) {
              throw error;
            }
            const repaired = await refreshDocumentFileReference(gram, req.file_id);
            if (!repaired) {
              throw error;
            }
            doc = getDocumentByFileId(req.file_id);
            const data = await readOnce();
            return { '@type': 'filePart', data };
          }
        }

        case 'deleteMessages': {
          await gram.deleteMessages(req.chat_id, req.message_ids, { revoke: true });
          return { '@type': 'ok' };
        }

        case 'sendMessage': {
          const input = req.input_message_content;
          const raw = input?.document?.data;
          if (input?.['@type'] === 'inputMessageDocument' && raw) {
            const file = await inputBlobToCustomFile(
              raw,
              input.document.name || 'file',
            );
            const sent = await gram.sendFile(req.chat_id, {
              file,
              caption: inputMessageCaption(input),
              forceDocument: true,
            });
            return { '@type': 'message', id: sent.id };
          }
          throw new Error('Unsupported sendMessage payload');
        }

        case 'editMessageText': {
          const text =
            req.input_message_content?.message?.formatted_text?.text
            || req.input_message_content?.message?.text?.text
            || '';
          await gram.editMessage(req.chat_id, {
            text,
            message: req.message_id,
          });
          return { '@type': 'ok' };
        }

        case 'editMessageMedia': {
          const input = req.input_message_content;
          if (input?.document?.data) {
            const file = await inputBlobToCustomFile(
              input.document.data,
              input.document.name || 'metadata.json',
            );
            await gram.editMessage(req.chat_id, {
              message: req.message_id,
              file,
              caption: inputMessageCaption(input),
              forceDocument: true,
            });
            return { '@type': 'ok' };
          }
          throw new Error('Unsupported editMessageMedia');
        }

        case 'deleteFile':
          return { '@type': 'ok' };

        case 'getRemoteFile':
        case 'getFileDownloadedPrefixSize':
          return { '@type': 'fileDownloadedPrefixSize', size: 0 };

        default:
          throw new Error(`MTProto shim: unhandled @type ${req['@type']}`);
      }
    },
  };

  return shim;
}

export { cancelMtprotoFilePartRequests };