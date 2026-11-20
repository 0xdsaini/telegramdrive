/**
 * CRA PUBLIC_URL / homepage-aware base path (no trailing slash), e.g. "" or "/telegramdrive".
 * Falls back to the first URL path segment when PUBLIC_URL is "." or missing (GitHub Project Pages).
 */

function detectRuntimeBasePath() {
  if (typeof window === 'undefined') {
    return '';
  }

  const link = document.querySelector('link[rel="manifest"]');
  if (link?.getAttribute('href')) {
    try {
      const manifestUrl = new URL(link.getAttribute('href'), window.location.href);
      const fromManifest = manifestUrl.pathname.replace(/\/manifest\.json$/i, '');
      if (fromManifest && fromManifest !== '/') {
        return fromManifest.replace(/\/$/, '');
      }
    } catch {
      /* ignore */
    }
  }

  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  if (parts[0] === 'stream') {
    return '';
  }
  return `/${parts[0]}`;
}

export function getAppBasePath() {
  const raw = process.env.PUBLIC_URL || '';
  if (raw && raw !== '.') {
    return raw.replace(/\/$/, '');
  }
  return detectRuntimeBasePath();
}

export function getAppOriginPathPrefix() {
  const base = getAppBasePath();
  return `${window.location.origin}${base}`;
}