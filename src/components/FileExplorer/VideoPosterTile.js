import React, { useEffect, useRef, useState } from 'react';
import { FaPlay } from 'react-icons/fa';
import { resolveVideoPoster } from '../../utils/videoThumbnailResolver';
import { formatVideoDuration } from '../../utils/mimeTypes';

const VideoPosterTile = ({
  telegramClient,
  chatId,
  messageId,
  className = '',
  compact = false,
}) => {
  const rootRef = useRef(null);
  const objectUrlRef = useRef(null);
  const [posterUrl, setPosterUrl] = useState(null);
  const [durationSec, setDurationSec] = useState(null);
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(false);

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
    if (!visible || !telegramClient || !chatId || !messageId) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const { posterBlob, durationSec: dur } = await resolveVideoPoster(
          telegramClient,
          chatId,
          messageId,
        );
        if (cancelled) {
          return;
        }
        if (posterBlob) {
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
          }
          const url = URL.createObjectURL(posterBlob);
          objectUrlRef.current = url;
          setPosterUrl(url);
          setDurationSec(dur);
          setFailed(false);
        } else {
          setPosterUrl(null);
          setFailed(true);
        }
      } catch {
        if (!cancelled) {
          setPosterUrl(null);
          setFailed(true);
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
  }, [visible, telegramClient, chatId, messageId]);

  const durationLabel = formatVideoDuration(durationSec);

  return (
    <div
      ref={rootRef}
      className={`video-poster-tile ${compact ? 'video-poster-tile--compact' : ''} ${className}`}
    >
      {posterUrl ? (
        <img src={posterUrl} alt="" className="video-poster-image" draggable={false} />
      ) : (
        <div className={`video-poster-placeholder ${failed ? 'video-poster-placeholder--failed' : ''}`}>
          <FaPlay className="video-poster-placeholder-icon" />
        </div>
      )}
      {durationLabel && <span className="video-duration-badge">{durationLabel}</span>}
    </div>
  );
};

export default VideoPosterTile;