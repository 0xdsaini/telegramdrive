const LANDSCAPE_TYPES = ['landscape', 'landscape-primary', 'landscape-secondary'];

export function isCoarseMobile() {
  return (
    typeof window !== 'undefined'
    && window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches
  );
}

export function isPortraitViewport() {
  return window.matchMedia?.('(orientation: portrait)')?.matches ?? false;
}

/** Call synchronously from a click/tap handler when possible (user activation). */
export async function lockLandscapeForPlayback() {
  if (!isCoarseMobile()) return false;
  const orientation = window.screen?.orientation;
  if (!orientation?.lock) return false;

  for (const type of LANDSCAPE_TYPES) {
    try {
      await orientation.lock(type);
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

export function unlockPlaybackOrientation() {
  try {
    window.screen?.orientation?.unlock?.();
  } catch {
    /* ignore */
  }
}