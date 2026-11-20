import { appendPersistedLog } from './reloadDebug';

const PREFIX = '[thumbs-boot]';

export function thumbsBootLog(phase, detail = {}) {
  const line = `${PREFIX} ${phase} ${JSON.stringify({
    ...detail,
    t: Date.now(),
  })}`;
  if (typeof console !== 'undefined') {
    console.log(line);
  }
  appendPersistedLog(line);
}

export function createThumbsBootTimer(phase) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return (detail = {}) => {
    const ms = Math.round(
      (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
    );
    thumbsBootLog(phase, { ...detail, ms });
    return ms;
  };
}