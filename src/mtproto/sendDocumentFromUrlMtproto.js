import { Api } from 'telegram';
import { registerDocumentFromMessage } from './documentRegistry';

/**
 * Telegram's curl often fails on raw.githubusercontent.com but can fetch jsDelivr's GitHub mirror.
 * @param {string} url
 * @returns {{ fetchUrl: string, rewritten: boolean, rewriteNote?: string }}
 */
export function resolveTelegramExternalUrl(url) {
  const trimmed = String(url || '').trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'https:') {
      return { fetchUrl: trimmed, rewritten: false };
    }

    if (u.hostname === 'raw.githubusercontent.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 4) {
        const [owner, repo, ref, ...rest] = parts;
        const filePath = rest.map((seg) => decodeURIComponent(seg)).join('/');
        const fetchUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/${filePath}${u.search}`;
        return {
          fetchUrl,
          rewritten: true,
          rewriteNote: 'GitHub raw URLs often fail on Telegram; using jsDelivr mirror.',
        };
      }
    }
  } catch {
    /* use original */
  }
  return { fetchUrl: trimmed, rewritten: false };
}

/**
 * Send a document by public HTTPS URL; Telegram's servers fetch the file.
 * @param {import('telegram').TelegramClient} gram
 * @param {number} chatId
 * @param {string} url
 * @param {{ spoiler?: boolean }} [opts]
 * @returns {Promise<{ message: object, fetchUrl: string, rewritten: boolean, rewriteNote?: string }>}
 */
export async function sendDocumentFromUrlMtproto(gram, chatId, url, opts = {}) {
  const trimmed = String(url || '').trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are supported');
  }

  const { fetchUrl, rewritten, rewriteNote } = resolveTelegramExternalUrl(trimmed);

  const media = new Api.InputMediaDocumentExternal({
    url: fetchUrl,
    spoiler: opts.spoiler || false,
  });

  const entity = await gram.getInputEntity(chatId);
  const request = new Api.messages.SendMedia({
    peer: entity,
    media,
    message: '',
  });

  const result = await gram.invoke(request);
  const message = gram._getResponseMessage(request, result, entity);
  if (!message) {
    throw new Error('No message returned from Telegram');
  }
  if (message.media?.document) {
    registerDocumentFromMessage(message.media.document, message);
  }
  return { message, fetchUrl, rewritten, rewriteNote };
}

/** Last path segment of the URL, or a fallback name. */
export function displayNameFromUrl(url) {
  try {
    const name = new URL(url).pathname.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name) : 'remote-file';
  } catch {
    return 'remote-file';
  }
}