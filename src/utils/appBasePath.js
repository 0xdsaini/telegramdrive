/**
 * CRA PUBLIC_URL / homepage-aware base path (no trailing slash), e.g. "" or "/trae1".
 */
export function getAppBasePath() {
  const raw = process.env.PUBLIC_URL || '';
  if (!raw || raw === '.') return '';
  return raw.replace(/\/$/, '');
}

export function getAppOriginPathPrefix() {
  const base = getAppBasePath();
  return `${window.location.origin}${base}`;
}