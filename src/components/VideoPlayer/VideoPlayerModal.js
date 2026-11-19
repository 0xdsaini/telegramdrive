import React, { useEffect, useRef, useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import { toggleStreamInUse } from '../../utils/streamBridge';
import { isStreamUrl } from '../../utils/streamUrl';
import { streamDebug, streamDebugError } from '../../utils/streamDebug';
import './VideoPlayerModal.css';

const VIDEO_EVENTS = [
  'loadstart',
  'progress',
  'suspend',
  'abort',
  'error',
  'emptied',
  'stalled',
  'loadedmetadata',
  'loadeddata',
  'canplay',
  'canplaythrough',
  'playing',
  'waiting',
  'seeking',
  'seeked',
  'ratechange',
  'durationchange',
  'pause',
  'ended',
];

const VideoPlayerModal = ({ open, title, streamUrl, onClose }) => {
  const videoRef = useRef(null);
  const [lastVideoError, setLastVideoError] = useState('');

  useEffect(() => {
    if (!open || !streamUrl || !videoRef.current) return;

    const video = videoRef.current;
    let previousSrc = '';

    const logVideoState = (eventName) => {
      streamDebug('video', `event: ${eventName}`, {
        src: video.currentSrc?.slice(0, 200),
        networkState: video.networkState,
        readyState: video.readyState,
        paused: video.paused,
        duration: video.duration,
        currentTime: video.currentTime,
        buffered: video.buffered?.length
          ? Array.from({ length: video.buffered.length }, (_, i) => [
              video.buffered.start(i),
              video.buffered.end(i),
            ])
          : [],
        error: video.error
          ? { code: video.error.code, message: video.error.message }
          : null,
      });
    };

    const handlers = VIDEO_EVENTS.map((name) => {
      const fn = () => {
        logVideoState(name);
        if (name === 'error' && video.error) {
          const msg = `MediaError code=${video.error.code} ${video.error.message || ''}`;
          setLastVideoError(msg);
          streamDebugError('video', 'element error', new Error(msg));
        }
      };
      video.addEventListener(name, fn);
      return [name, fn];
    });

    const setSrc = (url) => {
      streamDebug('video', 'setSrc', {
        url: url?.slice(0, 240),
        isStream: isStreamUrl(url),
        swController: !!navigator.serviceWorker?.controller,
      });
      if (previousSrc && isStreamUrl(previousSrc)) {
        toggleStreamInUse(previousSrc, false);
      }
      previousSrc = url;
      if (url && isStreamUrl(url)) {
        toggleStreamInUse(url, true);
      }
      setLastVideoError('');
      video.src = url;
    };

    setSrc(streamUrl);

    return () => {
      handlers.forEach(([name, fn]) => video.removeEventListener(name, fn));
      video.pause();
      if (previousSrc && isStreamUrl(previousSrc)) {
        toggleStreamInUse(previousSrc, false);
      }
      video.removeAttribute('src');
      video.load();
    };
  }, [open, streamUrl]);

  if (!open) {
    return null;
  }

  return (
    <div className="video-player-overlay" onClick={onClose}>
      <div className="video-player-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="video-player-header">
          <h3>{title}</h3>
          <button type="button" className="video-player-close" onClick={onClose} aria-label="Close">
            <FaTimes />
          </button>
        </div>
        {lastVideoError ? (
          <div className="video-player-debug-error">{lastVideoError}</div>
        ) : null}
        <div className="video-player-debug-hint">
          Console: filter <code>STREAM_DEBUG</code> or run <code>copyStreamDebugLogs()</code>
        </div>
        <video
          ref={videoRef}
          className="video-player-element"
          controls
          autoPlay
          playsInline
        />
      </div>
    </div>
  );
};

export default VideoPlayerModal;