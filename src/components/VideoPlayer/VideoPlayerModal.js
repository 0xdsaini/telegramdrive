import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaTimes,
  FaPlay,
  FaPause,
  FaVolumeUp,
  FaVolumeMute,
  FaExpand,
  FaCompress,
  FaCog,
} from 'react-icons/fa';
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

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const CONTROLS_HIDE_MS = 2800;
const SEEK_STEP = 10;
const DOUBLE_TAP_MS = 320;
const SEEK_RIPPLE_MS = 700;

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getBufferSegments(video) {
  if (!video?.buffered?.length) return [];
  const segments = [];
  for (let i = 0; i < video.buffered.length; i++) {
    segments.push({ start: video.buffered.start(i), end: video.buffered.end(i) });
  }
  return segments;
}

const VideoPlayerModal = ({ open, title, streamUrl, onClose, preparePlayback }) => {
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const hideControlsTimer = useRef(null);
  const scrubbingRef = useRef(false);
  const progressRef = useRef(null);
  const playbackRetryRef = useRef(false);
  const preparePlaybackRef = useRef(preparePlayback);
  const tapGestureRef = useRef({ pending: null, lastAt: 0 });
  const lastTouchAtRef = useRef(0);

  useEffect(() => {
    preparePlaybackRef.current = preparePlayback;
  }, [preparePlayback]);

  const [lastVideoError, setLastVideoError] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState([]);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [scrubPreview, setScrubPreview] = useState(null);
  const [immersiveMode, setImmersiveMode] = useState(false);
  const [seekRipple, setSeekRipple] = useState(null);

  const bumpControlsVisible = useCallback(() => {
    setShowControls(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) {
        setShowControls(false);
        setShowSettings(false);
      }
    }, CONTROLS_HIDE_MS);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
    bumpControlsVisible();
  }, [bumpControlsVisible]);

  const seekBy = useCallback(
    (delta) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration)) return;
      const next = Math.min(Math.max(0, video.currentTime + delta), video.duration);
      video.currentTime = next;
      bumpControlsVisible();
    },
    [bumpControlsVisible]
  );

  const seekToFraction = useCallback(
    (fraction) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(video.duration)) return;
      video.currentTime = fraction * video.duration;
      bumpControlsVisible();
    },
    [bumpControlsVisible]
  );

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
    bumpControlsVisible();
  }, [bumpControlsVisible]);

  const changeVolume = useCallback(
    (value) => {
      const video = videoRef.current;
      if (!video) return;
      const v = Math.min(1, Math.max(0, value));
      video.volume = v;
      setVolume(v);
      if (v > 0 && video.muted) {
        video.muted = false;
        setIsMuted(false);
      }
      bumpControlsVisible();
    },
    [bumpControlsVisible]
  );

  const triggerSeekRipple = useCallback((side) => {
    const burst = Date.now();
    setSeekRipple({ side, burst });
    window.setTimeout(() => {
      setSeekRipple((prev) => (prev?.burst === burst ? null : prev));
    }, SEEK_RIPPLE_MS);
  }, []);

  const handleVideoAreaSeek = useCallback(
    (side) => {
      seekBy(side === 'left' ? -SEEK_STEP : SEEK_STEP);
      triggerSeekRipple(side);
    },
    [seekBy, triggerSeekRipple]
  );

  const clearTapGesture = useCallback(() => {
    if (tapGestureRef.current.pending) {
      clearTimeout(tapGestureRef.current.pending);
      tapGestureRef.current.pending = null;
    }
    tapGestureRef.current.lastAt = 0;
  }, []);

  const handleVideoAreaClick = useCallback(
    (e) => {
      if (Date.now() - lastTouchAtRef.current < 500) return;
      if (e.pointerType && e.pointerType !== 'mouse') return;
      togglePlay();
    },
    [togglePlay]
  );

  const handleVideoAreaPointerUp = useCallback(
    (e) => {
      if (e.pointerType !== 'touch') return;
      lastTouchAtRef.current = Date.now();

      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const now = Date.now();

      if (now - tapGestureRef.current.lastAt < DOUBLE_TAP_MS) {
        clearTapGesture();
        e.preventDefault();
        handleVideoAreaSeek(x < rect.width / 2 ? 'left' : 'right');
        return;
      }

      tapGestureRef.current.lastAt = now;
      tapGestureRef.current.pending = window.setTimeout(() => {
        tapGestureRef.current.pending = null;
        tapGestureRef.current.lastAt = 0;
        bumpControlsVisible();
        const video = videoRef.current;
        if (video?.paused) togglePlay();
      }, DOUBLE_TAP_MS);
    },
    [bumpControlsVisible, clearTapGesture, handleVideoAreaSeek, togglePlay]
  );

  const swallowVideoDoubleClick = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearTapGesture();
    },
    [clearTapGesture]
  );

  const toggleFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;

    const inNativeFs = !!document.fullscreenElement;
    if (inNativeFs) {
      try {
        await document.exitFullscreen();
      } catch {
        /* ignore */
      }
      bumpControlsVisible();
      return;
    }

    if (immersiveMode) {
      setImmersiveMode(false);
      bumpControlsVisible();
      return;
    }

    const req =
      stage.requestFullscreen?.bind(stage)
      || stage.webkitRequestFullscreen?.bind(stage)
      || stage.webkitEnterFullscreen?.bind(stage);

    if (req) {
      try {
        await req();
        bumpControlsVisible();
        return;
      } catch {
        /* fall through to immersive */
      }
    }

    setImmersiveMode(true);
    bumpControlsVisible();
  }, [bumpControlsVisible, immersiveMode]);

  const setRate = useCallback(
    (rate) => {
      const video = videoRef.current;
      if (!video) return;
      video.playbackRate = rate;
      setPlaybackRate(rate);
      setShowSettings(false);
      bumpControlsVisible();
    },
    [bumpControlsVisible]
  );

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement || immersiveMode);
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    onFs();
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('webkitfullscreenchange', onFs);
    };
  }, [immersiveMode]);

  useEffect(() => {
    if (!open) {
      setImmersiveMode(false);
      clearTapGesture();
      setSeekRipple(null);
      document.body.classList.remove('yt-player-open');
      return undefined;
    }
    document.body.classList.add('yt-player-open');
    return () => document.body.classList.remove('yt-player-open');
  }, [open, clearTapGesture]);

  useEffect(() => {
    if (!immersiveMode) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [immersiveMode]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J':
          e.preventDefault();
          seekBy(-SEEK_STEP);
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
          e.preventDefault();
          seekBy(SEEK_STEP);
          break;
        case 'ArrowUp':
          e.preventDefault();
          changeVolume(Math.min(1, (videoRef.current?.volume ?? volume) + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          changeVolume(Math.max(0, (videoRef.current?.volume ?? volume) - 0.05));
          break;
        case 'Escape':
          if (immersiveMode) {
            setImmersiveMode(false);
          } else if (!document.fullscreenElement) {
            onClose();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, immersiveMode, togglePlay, toggleFullscreen, toggleMute, seekBy, changeVolume, volume, onClose]);

  useEffect(() => {
    if (!open || !streamUrl || !videoRef.current) return undefined;

    const video = videoRef.current;
    let previousSrc = '';
    let cancelled = false;
    playbackRetryRef.current = false;

    const syncUi = () => {
      setCurrentTime(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setBuffered(getBufferSegments(video));
      setIsPlaying(!video.paused && !video.ended);
      setIsMuted(video.muted);
      setVolume(video.volume);
      setPlaybackRate(video.playbackRate);
    };

    const logVideoState = (eventName) => {
      streamDebug('video', `event: ${eventName}`, {
        src: video.currentSrc?.slice(0, 200),
        networkState: video.networkState,
        readyState: video.readyState,
        paused: video.paused,
        duration: video.duration,
        currentTime: video.currentTime,
        buffered: getBufferSegments(video),
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
          const retryable =
            isStreamUrl(streamUrl)
            && (video.error.code === 2 || video.error.code === 3 || video.error.code === 4);
          if (retryable && !playbackRetryRef.current && preparePlaybackRef.current) {
            playbackRetryRef.current = true;
            streamDebug('video', 'retry playback after media error', { code: video.error.code });
            (async () => {
              try {
                await preparePlaybackRef.current({ force: true });
                if (cancelled) return;
                if (previousSrc && isStreamUrl(previousSrc)) {
                  toggleStreamInUse(previousSrc, false);
                }
                setLastVideoError('');
                video.src = '';
                video.load();
                setSrc(streamUrl);
              } catch (retryError) {
                streamDebugError('video', 'playback retry failed', retryError);
                setLastVideoError(
                  retryError?.message
                    || 'Playback failed after idle. Switch back to this tab and try Play again, or open the app in a new tab.'
                );
              }
            })();
          }
        }
        if (name === 'playing') setIsWaiting(false);
        if (name === 'waiting') setIsWaiting(true);
        syncUi();
      };
      video.addEventListener(name, fn);
      return [name, fn];
    });

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      setBuffered(getBufferSegments(video));
    };
    video.addEventListener('timeupdate', onTimeUpdate);

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
      video.play().catch(() => {});
    };

    (async () => {
      try {
        if (preparePlaybackRef.current) {
          setIsPreparing(true);
          await preparePlaybackRef.current();
        }
        if (cancelled) return;
        setSrc(streamUrl);
        bumpControlsVisible();
      } catch (prepareError) {
        streamDebugError('video', 'preparePlayback failed', prepareError);
        setLastVideoError(prepareError?.message || 'Could not start streaming playback.');
      } finally {
        if (!cancelled) setIsPreparing(false);
      }
    })();

    return () => {
      cancelled = true;
      setIsPreparing(false);
      handlers.forEach(([name, fn]) => video.removeEventListener(name, fn));
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.pause();
      if (previousSrc && isStreamUrl(previousSrc)) {
        toggleStreamInUse(previousSrc, false);
      }
      video.removeAttribute('src');
      video.load();
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    };
  }, [open, streamUrl, bumpControlsVisible, preparePlayback]);

  const handleProgressPointer = (clientX, rect) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setScrubPreview(fraction);
    if (scrubbingRef.current) {
      seekToFraction(fraction);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const onDocMouseUp = () => {
      if (scrubbingRef.current) {
        scrubbingRef.current = false;
        setScrubPreview(null);
      }
    };
    const onDocMouseMove = (e) => {
      if (!scrubbingRef.current || !progressRef.current) return;
      if (!Number.isFinite(duration) || duration <= 0) return;
      const rect = progressRef.current.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      setScrubPreview(fraction);
      seekToFraction(fraction);
    };
    document.addEventListener('mouseup', onDocMouseUp);
    document.addEventListener('mousemove', onDocMouseMove);
    return () => {
      document.removeEventListener('mouseup', onDocMouseUp);
      document.removeEventListener('mousemove', onDocMouseMove);
    };
  }, [open, duration, seekToFraction]);

  if (!open) {
    return null;
  }

  const playedPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className="yt-player-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        ref={stageRef}
        className={`yt-player-stage${isFullscreen ? ' yt-player-stage--fullscreen' : ''}${
          immersiveMode ? ' yt-player-stage--immersive' : ''
        }${showControls ? ' yt-player-stage--controls-visible' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onMouseMove={bumpControlsVisible}
        onTouchStart={bumpControlsVisible}
      >
        <button
          type="button"
          className="yt-player-close"
          onClick={onClose}
          aria-label="Close player"
        >
          <FaTimes />
        </button>

        <div
          className="yt-player-video-wrap"
          onClick={handleVideoAreaClick}
          onPointerUp={handleVideoAreaPointerUp}
          onDoubleClick={swallowVideoDoubleClick}
          role="presentation"
        >
          <video ref={videoRef} className="yt-player-video" playsInline />

          {(isPreparing || isWaiting) && !lastVideoError ? (
            <div className="yt-player-spinner" aria-hidden />
          ) : null}

          {isPreparing && !lastVideoError ? (
            <div className="yt-player-preparing" aria-live="polite">
              Activating stream worker…
            </div>
          ) : null}

          {!isPlaying && !isWaiting && !isPreparing && !lastVideoError ? (
            <button
              type="button"
              className="yt-player-big-play"
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                clearTapGesture();
                togglePlay();
              }}
              aria-label="Play"
            >
              <FaPlay />
            </button>
          ) : null}

          {seekRipple ? (
            <div
              className={`yt-player-seek-ripple yt-player-seek-ripple--${seekRipple.side}`}
              key={seekRipple.burst}
              aria-hidden
            >
              <span className="yt-player-seek-ripple-ring" />
              <span className="yt-player-seek-ripple-label">
                {seekRipple.side === 'left' ? '−10 seconds' : '+10 seconds'}
              </span>
            </div>
          ) : null}

          <div className="yt-player-gradient yt-player-gradient--top">
            <h2 className="yt-player-title">{title}</h2>
          </div>

          {lastVideoError ? (
            <div className="yt-player-error-banner">{lastVideoError}</div>
          ) : null}
        </div>

        <div className="yt-player-controls" onClick={(e) => e.stopPropagation()}>
          <div
            ref={progressRef}
            className="yt-player-progress"
            onMouseDown={(e) => {
              scrubbingRef.current = true;
              const rect = e.currentTarget.getBoundingClientRect();
              handleProgressPointer(e.clientX, rect);
            }}
            onMouseLeave={() => {
              if (!scrubbingRef.current) setScrubPreview(null);
            }}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={duration}
            aria-valuenow={currentTime}
            aria-label="Seek"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft') seekBy(-SEEK_STEP);
              if (e.key === 'ArrowRight') seekBy(SEEK_STEP);
            }}
          >
            <div className="yt-player-progress-rail">
              {buffered.map((seg, i) => (
                <span
                  key={`buf-${i}-${seg.start}`}
                  className="yt-player-progress-buffered"
                  style={{
                    left: `${duration > 0 ? (seg.start / duration) * 100 : 0}%`,
                    width: `${duration > 0 ? ((seg.end - seg.start) / duration) * 100 : 0}%`,
                  }}
                />
              ))}
              <span
                className="yt-player-progress-played"
                style={{ width: `${scrubPreview != null ? scrubPreview * 100 : playedPercent}%` }}
              />
              <span
                className="yt-player-progress-thumb"
                style={{ left: `${scrubPreview != null ? scrubPreview * 100 : playedPercent}%` }}
              />
            </div>
          </div>

          <div className="yt-player-controls-row">
            <div className="yt-player-controls-left">
              <button type="button" className="yt-player-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
                {isPlaying ? <FaPause /> : <FaPlay />}
              </button>

              <div className="yt-player-volume">
                <button type="button" className="yt-player-btn" onClick={toggleMute} aria-label={isMuted ? 'Unmute' : 'Mute'}>
                  {isMuted || volume === 0 ? <FaVolumeMute /> : <FaVolumeUp />}
                </button>
                <input
                  type="range"
                  className="yt-player-volume-slider"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => changeVolume(parseFloat(e.target.value, 10))}
                  aria-label="Volume"
                />
              </div>

              <span className="yt-player-time">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </div>

            <div className="yt-player-controls-right">
              <div className="yt-player-settings-wrap">
                <button
                  type="button"
                  className="yt-player-btn"
                  onClick={() => setShowSettings((s) => !s)}
                  aria-expanded={showSettings}
                  aria-label="Playback speed"
                >
                  <FaCog />
                  <span className="yt-player-rate-label">{playbackRate === 1 ? '' : `${playbackRate}×`}</span>
                </button>
                {showSettings ? (
                  <ul className="yt-player-settings-menu" role="menu">
                    {PLAYBACK_RATES.map((rate) => (
                      <li key={rate} role="none">
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={playbackRate === rate}
                          className={playbackRate === rate ? 'is-active' : ''}
                          onClick={() => setRate(rate)}
                        >
                          {rate === 1 ? 'Normal' : `${rate}×`}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              <button
                type="button"
                className="yt-player-btn"
                onClick={toggleFullscreen}
                aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
              >
                {isFullscreen ? <FaCompress /> : <FaExpand />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoPlayerModal;