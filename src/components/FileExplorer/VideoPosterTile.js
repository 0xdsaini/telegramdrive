import React, { useEffect, useRef, useState } from 'react';
import { FaPlay } from 'react-icons/fa';
import { resolveVideoPoster } from '../../utils/videoThumbnailResolver';
import { captureVideoPosterFromStream } from '../../utils/captureVideoPosterFromStream';
import { subscribePlaybackIdle } from '../../utils/streamBridge';
import { formatVideoDuration } from '../../utils/mimeTypes';

const VideoPosterTile = ({
  telegramClient,
  chatId,
  messageId,
  fileName,
  className = '',
  compact = false,
}) => {
  const rootRef = useRef(null);
  const objectUrlRef = useRef(null);
  const [posterUrl, setPosterUrl] = useState(null);
  const [durationSec, setDurationSec] = useState(null);
  const [failed, setFailed] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [visible, setVisible] = useState(false);
  const [backfillPass, setBackfillPass] = useState(0);

  const applyPosterBlob = (posterBlob, dur) => {
    if (!posterBlob) {
      return;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
    const url = URL.createObjectURL(posterBlob);
    objectUrlRef.current = url;
    setPosterUrl(url);
    setDurationSec(dur ?? null);
    setFailed(false);
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px', threshold: 0.01 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return subscribePlaybackIdle(() => {
      setBackfillPass((p) => p + 1);
    });
  }, []);

  useEffect(() => {
    if (!visible || !telegramClient || !chatId || !messageId) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const resolved = await resolveVideoPoster(telegramClient, chatId, messageId);
        if (cancelled) {
          return;
        }
        if (resolved.posterBlob && !resolved.needsBackfill) {
          applyPosterBlob(resolved.posterBlob, resolved.durationSec);
          return;
        }

        if (resolved.durationSec != null) {
          setDurationSec(resolved.durationSec);
        }

        if (fileName) {
          setIsBackfilling(true);
          setFailed(false);
          const backfill = await captureVideoPosterFromStream(
            telegramClient,
            chatId,
            messageId,
            fileName,
          );
          if (cancelled) {
            return;
          }
          if (backfill.posterBlob) {
            applyPosterBlob(
              backfill.posterBlob,
              backfill.durationSec ?? resolved.durationSec,
            );
          } else if (backfill.skipped) {
            setFailed(false);
          } else {
            setPosterUrl(null);
            setFailed(true);
          }
          setIsBackfilling(false);
          return;
        }

        setPosterUrl(null);
        setFailed(true);
      } catch {
        if (!cancelled) {
          setPosterUrl(null);
          setFailed(true);
          setIsBackfilling(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [visible, telegramClient, chatId, messageId, fileName, backfillPass]);

  const durationLabel = formatVideoDuration(durationSec);

  return (
    <div
      ref={rootRef}
      className={`video-poster-tile ${compact ? 'video-poster-tile--compact' : ''} ${className}`}
    >
      {posterUrl ? (
        <img src={posterUrl} alt="" className="video-poster-image" draggable={false} />
      ) : (
        <div
          className={`video-poster-placeholder ${failed ? 'video-poster-placeholder--failed' : ''} ${
            isBackfilling ? 'video-poster-placeholder--loading' : ''
          }`}
        >
          <FaPlay className="video-poster-placeholder-icon" />
          {isBackfilling && !compact && (
            <span className="video-poster-loading-label">Generating…</span>
          )}
        </div>
      )}
      {durationLabel && <span className="video-duration-badge">{durationLabel}</span>}
    </div>
  );
};

export default VideoPosterTile;