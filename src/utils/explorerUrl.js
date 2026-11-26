import { getAppBasePath } from './appBasePath';
import { findFolderByPath } from './fileStructureUtils';

/** Explorer URLs must not overlap the media stream route (`/stream/...`). */
const RESERVED_TOP_LEVEL = new Set(['stream']);

export const PENDING_EXPLORER_PATH_KEY = 'tg-drive-pending-explorer-path';

function normalizeExplorerPath(path) {
  if (!path || path === '') {
    return '/';
  }
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  const segments = withSlash.split('/').filter(Boolean);
  if (segments.length > 0 && RESERVED_TOP_LEVEL.has(segments[0])) {
    return '/';
  }
  return segments.length ? `/${segments.join('/')}` : '/';
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Path after app base, decoded virtual path (e.g. `/media/videos/foo.mp4`).
 */
export function stripAppBaseFromPathname(pathname) {
  const base = getAppBasePath();
  let rest = pathname || '/';
  if (base) {
    if (rest === base || rest === `${base}/`) {
      return '/';
    }
    if (rest.startsWith(`${base}/`)) {
      rest = rest.slice(base.length);
    }
  }
  if (!rest.startsWith('/')) {
    rest = `/${rest}`;
  }
  const segments = rest.split('/').filter(Boolean).map(decodePathSegment);
  return normalizeExplorerPath(segments.length ? `/${segments.join('/')}` : '/');
}

export function parseExplorerUrlFromLocation(loc = window.location) {
  return stripAppBaseFromPathname(loc.pathname);
}

function encodeExplorerSegments(folderPath, fileName) {
  const folder = normalizeExplorerPath(folderPath);
  const parts =
    folder === '/'
      ? []
      : folder
          .split('/')
          .filter(Boolean)
          .map((segment) => encodeURIComponent(segment));

  if (fileName) {
    parts.push(encodeURIComponent(fileName));
  }

  if (parts.length === 0) {
    return '/';
  }
  return `/${parts.join('/')}`;
}

/**
 * Full browser pathname (includes CRA / GitHub Pages base).
 */
export function buildExplorerBrowserPathname(folderPath, fileName = null) {
  const base = getAppBasePath();
  const explorerPath = encodeExplorerSegments(folderPath, fileName);
  if (!base) {
    return explorerPath;
  }
  if (explorerPath === '/') {
    return `${base}/`;
  }
  return `${base}${explorerPath}`;
}

/**
 * Map URL virtual path onto metadata tree.
 */
export function resolveExplorerLocation(fileStructure, explorerPath) {
  const normalized = normalizeExplorerPath(explorerPath);

  if (!fileStructure || normalized === '/') {
    return { folderPath: '/', fileName: null, valid: true };
  }

  if (findFolderByPath(fileStructure, normalized)) {
    return { folderPath: normalized, fileName: null, valid: true };
  }

  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { folderPath: '/', fileName: null, valid: true };
  }

  const last = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);
  const parentPath = parentSegments.length ? `/${parentSegments.join('/')}` : '/';
  const parentFolder = findFolderByPath(fileStructure, parentPath);

  if (parentFolder) {
    const file = parentFolder.files.find((f) => f.filename === last);
    if (file) {
      return { folderPath: parentPath, fileName: last, valid: true };
    }
  }

  for (let depth = segments.length - 1; depth >= 1; depth -= 1) {
    const partial = `/${segments.slice(0, depth).join('/')}`;
    if (findFolderByPath(fileStructure, partial)) {
      return { folderPath: partial, fileName: null, valid: false };
    }
  }

  return { folderPath: '/', fileName: null, valid: false };
}

export function readPendingExplorerPath() {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(PENDING_EXPLORER_PATH_KEY);
    if (!raw) {
      return null;
    }
    sessionStorage.removeItem(PENDING_EXPLORER_PATH_KEY);
    return stripAppBaseFromPathname(raw);
  } catch {
    return null;
  }
}

export function rememberPendingExplorerPath(pathname) {
  if (typeof window === 'undefined') {
    return;
  }
  const explorer = stripAppBaseFromPathname(pathname);
  if (explorer === '/') {
    return;
  }
  try {
    sessionStorage.setItem(PENDING_EXPLORER_PATH_KEY, pathname);
  } catch {
    /* ignore */
  }
}

export function replaceExplorerBrowserUrl(folderPath, fileName = null) {
  if (typeof window === 'undefined') {
    return;
  }
  const nextPath = buildExplorerBrowserPathname(folderPath, fileName);
  const { search, hash } = window.location;
  const current = window.location.pathname;
  if (current === nextPath) {
    return;
  }
  window.history.replaceState({ tgExplorer: true }, '', `${nextPath}${search}${hash}`);
}

export function pushExplorerBrowserUrl(folderPath, fileName = null) {
  if (typeof window === 'undefined') {
    return;
  }
  const nextPath = buildExplorerBrowserPathname(folderPath, fileName);
  const { search, hash } = window.location;
  window.history.pushState({ tgExplorer: true }, '', `${nextPath}${search}${hash}`);
}

export function restoreGhPagesSpaPath() {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const saved = sessionStorage.getItem('gh-spa-path');
    if (!saved) {
      return false;
    }
    sessionStorage.removeItem('gh-spa-path');
    const url = new URL(saved, window.location.origin);
    window.history.replaceState({ tgExplorer: true }, '', `${url.pathname}${url.search}${url.hash}`);
    return true;
  } catch {
    return false;
  }
}