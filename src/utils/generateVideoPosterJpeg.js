import {
  capturePosterAfterSeeks,
  waitForVideoEvent,
} from './videoPosterCanvas';

/**
 * Generate a JPEG poster from a local File (upload). Returns dimensions for inputThumbnail.
 * @returns {Promise<{ blob: Blob, width: number, height: number }|null>}
 */
export async function generateVideoPosterJpeg(file, { timeoutMs = 45000 } = {}) {
  if (!file || typeof document === 'undefined') {
    return null;
  }

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = objectUrl;

  try {
    await waitForVideoEvent(video, 'loadedmetadata', timeoutMs);
    const blob = await capturePosterAfterSeeks(video, { timeoutMs });
    if (!blob) {
      return null;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    let tw = width;
    let th = height;
    const maxDim = 320;
    if (width >= height && width > maxDim) {
      tw = maxDim;
      th = Math.round(height * (maxDim / width));
    } else if (height > width && height > maxDim) {
      th = maxDim;
      tw = Math.round(width * (maxDim / height));
    }

    return { blob, width: tw, height: th };
  } catch {
    return null;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

/**
 * @returns {Promise<Blob|null>} JPEG blob for caching after upload (same bytes as sent thumb).
 */
export async function generateVideoPosterBlob(file) {
  const poster = await generateVideoPosterJpeg(file);
  return poster?.blob ?? null;
}