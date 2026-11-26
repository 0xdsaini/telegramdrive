import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { TELEGRAM_API_ID, TELEGRAM_API_HASH } from '../components/TelegramMessenger/constants';
import { createTdlibCompatShim } from './tdlibCompatShim';

const SESSION_KEY = 'gramjs_string_session';

/**
 * MTProto client (GramJS) with TDLib-shaped `send()` for the existing React app.
 */
export async function createGramTelegramClient() {
  const savedSession = localStorage.getItem(SESSION_KEY) || '';
  const session = new StringSession(savedSession);
  const apiId = Number(TELEGRAM_API_ID);
  const apiHash = TELEGRAM_API_HASH;

  const gram = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 8,
    requestRetries: 5,
    /** Avoid ~10s connect stalls that showed up as periodic upload throttling in Activity Monitor */
    timeout: 60,
    useWSS: true,
  });

  const saveSession = () => {
    const s = gram.session.save();
    if (s) localStorage.setItem(SESSION_KEY, s);
  };

  await gram.connect();

  const compat = createTdlibCompatShim(gram, {
    apiId,
    apiHash,
    saveSession,
    onAuthReady: () => {
      if (typeof compat.onUpdate === 'function') {
        compat.onUpdate({
          '@type': 'updateAuthorizationState',
          authorization_state: { '@type': 'authorizationStateReady' },
        });
      }
    },
  });

  if (await gram.checkAuthorization()) {
    saveSession();
    compat._setAuthorized(true);
  }

  return compat;
}

export function clearGramSession() {
  localStorage.removeItem(SESSION_KEY);
}