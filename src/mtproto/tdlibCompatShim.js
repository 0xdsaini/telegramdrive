import { Api } from 'telegram';
import { CustomFile } from 'telegram/client/uploads';
import { registerDocumentFromMessage, getDocumentByFileId } from './documentRegistry';
import { cancelMtprotoFilePartRequests, readDocumentPart } from './requestFilePartMtproto';
import { messageToTdlibShape } from './messageContentShape';
import {
  isFileReferenceError,
  refreshDocumentFileReference,
} from './refreshDocumentReference';

function dialogChatId(dialog) {
  const id = dialog?.id ?? dialog?.entity?.id;
  return typeof id === 'bigint' ? Number(id) : id;
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
          const msgs = await gram.getMessages(req.chat_id, {
            search: req.query || '',
            limit: req.limit || 10,
          });
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
          return {
            '@type': 'file',
            id: req.file_id,
            size: doc?.size || 0,
            local: { downloaded_prefix_size: 0, is_downloading_completed: false },
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
            const blob = raw instanceof Blob ? raw : new Blob([raw]);
            const fileName = input.document.name || 'file';
            const file = new CustomFile(fileName, blob.size, undefined, blob);
            const sent = await gram.sendFile(req.chat_id, { file, caption: '' });
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
            const blob = input.document.data;
            const fileName = input.document.name || 'metadata.json';
            const file = new CustomFile(fileName, blob.size, undefined, blob);
            await gram.editMessage(req.chat_id, {
              message: req.message_id,
              file,
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