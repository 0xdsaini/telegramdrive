/** Posters we generated ourselves (stream capture or upload-time JPEG). */
export const TRUSTED_POSTER_SOURCES = new Set([
  'client-stream',
  'upload-jpeg',
  'thumbs-db',
]);

export function isTrustedPosterSource(source) {
  return TRUSTED_POSTER_SOURCES.has(source);
}