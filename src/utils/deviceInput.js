/**
 * True when the primary input supports hover (mouse/trackpad), not touch-first UIs.
 */
export function isDesktopFinePointer() {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}