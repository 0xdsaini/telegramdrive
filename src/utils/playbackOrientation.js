const LANDSCAPE_TYPES = ['landscape', 'landscape-primary', 'landscape-secondary'];
const PORTRAIT_TYPES = ['portrait', 'portrait-primary', 'portrait-secondary'];

export function isCoarseMobile() {
  return (
    typeof window !== 'undefined'
    && window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches
  );
}

export function isPortraitViewport() {
  return window.matchMedia?.('(orientation: portrait)')?.matches ?? false;
}

const isLandscapeType = (type) => (
  typeof type === 'string' && LANDSCAPE_TYPES.includes(type)
);

const isPortraitType = (type) => (
  typeof type === 'string' && PORTRAIT_TYPES.includes(type)
);

async function lockOrientationTypes(types, preferCurrentIfMatches) {
  if (!isCoarseMobile()) return false;
  const orientation = window.screen?.orientation;
  if (!orientation?.lock) return false;

  const current = orientation.type;
  if (preferCurrentIfMatches?.(current)) {
    try {
      await orientation.lock(current);
      return true;
    } catch {
      return true;
    }
  }

  for (const type of types) {
    try {
      await orientation.lock(type);
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

/** Call synchronously from a click/tap handler when possible (user activation). */
export async function lockLandscapeForPlayback() {
  return lockOrientationTypes(LANDSCAPE_TYPES, isLandscapeType);
}

/** Keep audio playback in portrait on mobile. */
export async function lockPortraitForPlayback() {
  return lockOrientationTypes(PORTRAIT_TYPES, isPortraitType);
}

export function unlockPlaybackOrientation() {
  try {
    window.screen?.orientation?.unlock?.();
  } catch {
    /* ignore */
  }
}