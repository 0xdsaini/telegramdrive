const MAX_THUMB_BYTES = 200 * 1024;

/**
 * Pick a seek time near the middle, away from typical intro/outro black frames.
 */
export function posterSeekTime(duration) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0;
  }
  if (duration <= 4) {
    return duration * 0.5;
  }
  const inset = Math.min(3, duration * 0.1);
  const center = duration * 0.5;
  return Math.min(Math.max(center, inset), Math.max(inset, duration - inset));
}

/** @deprecated name kept for callers — uses posterSeekTime */
export function seekVideoForPoster(video) {
  return posterSeekTime(video.duration);
}

export function isFrameMostlyBlack(video, { threshold = 22, sample = 24 } = {}) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    return true;
  }
  const w = Math.min(sample, vw);
  const h = Math.min(sample, vh);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return true;
  }
  ctx.drawImage(video, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  let sum = 0;
  const pixels = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  return sum / pixels < threshold;
}

function afterSeekPaintDelay() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

export function waitForVideoEvent(video, eventName, timeoutMs) {
  return new Promise((resolve, reject) => {
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error(`video ${eventName} error`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`video ${eventName} timeout`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(eventName, onOk);
      video.removeEventListener('error', onErr);
    };

    video.addEventListener(eventName, onOk, { once: true });
    video.addEventListener('error', onErr, { once: true });
  });
}

function buildSeekCandidates(duration) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return [0];
  }
  return [
    posterSeekTime(duration),
    duration * 0.42,
    duration * 0.58,
    duration * 0.33,
    duration * 0.67,
  ];
}

/**
 * Seek through likely non-black positions (middle-first) and capture JPEG.
 */
export async function capturePosterAfterSeeks(video, { timeoutMs = 45000 } = {}) {
  const duration = Number.isFinite(video.duration) ? video.duration : 0;
  const candidates = buildSeekCandidates(duration);
  const tried = new Set();

  for (const raw of candidates) {
    const seekTo =
      duration > 0
        ? Math.max(0, Math.min(raw, duration - 0.05))
        : 0;
    const key = Math.round(seekTo * 200);
    if (tried.has(key)) {
      continue;
    }
    tried.add(key);

    video.currentTime = seekTo;
    // eslint-disable-next-line no-await-in-loop
    await waitForVideoEvent(video, 'seeked', timeoutMs);
    // eslint-disable-next-line no-await-in-loop
    await afterSeekPaintDelay();

    if (!isFrameMostlyBlack(video)) {
      // eslint-disable-next-line no-await-in-loop
      const blob = await captureJpegUnder200Kb(video);
      if (blob) {
        return blob;
      }
    }
  }

  return captureJpegUnder200Kb(video);
}

/**
 * Draw current video frame to a JPEG Blob scaled to maxDim on the longest edge.
 */
export function captureFrameFromVideo(video, maxDim = 320, quality = 0.75) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) {
    return Promise.resolve(null);
  }

  let tw = vw;
  let th = vh;
  if (vw >= vh && vw > maxDim) {
    tw = maxDim;
    th = Math.round(vh * (maxDim / vw));
  } else if (vh > vw && vh > maxDim) {
    th = maxDim;
    tw = Math.round(vw * (maxDim / vh));
  }

  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return Promise.resolve(null);
  }
  ctx.drawImage(video, 0, 0, tw, th);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
  });
}

/**
 * Capture JPEG and retry lower quality until under TDLib 200KB cap (or min quality).
 */
export async function captureJpegUnder200Kb(video, maxDim = 320) {
  let quality = 0.82;
  let lastBlob = null;

  while (quality >= 0.35) {
    // eslint-disable-next-line no-await-in-loop
    const blob = await captureFrameFromVideo(video, maxDim, quality);
    if (!blob) {
      return null;
    }
    lastBlob = blob;
    if (blob.size <= MAX_THUMB_BYTES) {
      return blob;
    }
    quality -= 0.12;
  }

  return lastBlob;
}