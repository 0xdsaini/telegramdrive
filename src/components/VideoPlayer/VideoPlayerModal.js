import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  FaTimes,
  FaPlay,
  FaPause,
  FaVolumeUp,
  FaVolumeMute,
  FaExpand,
  FaCompress,
  FaCog,
  FaMusic,
} from 'react-icons/fa';
import { toggleStreamInUse } from '../../utils/streamBridge';
import { isStreamUrl } from '../../utils/streamUrl';
import { streamDebug, streamDebugError } from '../../utils/streamDebug';
import {
  isPortraitViewport,
  lockLandscapeForPlayback,
  lockPortraitForPlayback,
  unlockPlaybackOrientation,
} from '../../utils/playbackOrientation';
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
const DOUBLE_TAP_MS = 260;
const SEEK_RIPPLE_MS = 520;
const CENTER_FLASH_MS = 480;
const SEEK_STACK_MS = 650;
const TOUCH_CLICK_GUARD_MS = 900;
const TRANSPORT_LOCK_MS = 450;
const SWIPE_DISMISS_CLOSE_PX = 110;
const SWIPE_DISMISS_AXIS_PX = 16;
const HOLD_2X_MS = 220;
const HOLD_2X_MOVE_CANCEL_PX = 14;
const HOLD_2X_RATE = 2;

const IS_COARSE_POINTER =
  typeof window !== 'undefined'
  && window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches;

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

const VideoPlayerModal = ({ open, title, streamUrl, onClose, preparePlayback, audioOnly = false }) => {
  const stageRef = useRef(null);
  const videoRef = useRef(null);
  const touchGestureRef = useRef(null);
  const swipeDismissYRef = useRef(0);
  const swipeGestureRef = useRef({
    startX: 0,
    startY: 0,
    tracking: false,
    axisChosen: false,
    dismissing: false,
  });
  const hideControlsTimer = useRef(null);
  const scrubbingRef = useRef(false);
  const progressRef = useRef(null);
  const playbackRetryRef = useRef(false);
  const preparePlaybackRef = useRef(preparePlayback);
  const tapGestureRef = useRef({ pending: null, lastAt: 0, lastSide: null });
  const lastTouchAtRef = useRef(0);
  const touchSessionRef = useRef({ controlsVisible: true, width: 0 });
  const centerFlashTimerRef = useRef(null);
  const seekStackRef = useRef({ side: null, burst: 0, steps: 0 });
  const transportLockRef = useRef(0);
  const preferredPlaybackRateRef = useRef(1);
  const speedBoostRef = useRef({
    timer: null,
    active: false,
    savedRate: 1,
    startX: 0,
    startY: 0,
    touchId: null,
  });

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
  const [centerFlash, setCenterFlash] = useState(null);
  const [portraitViewport, setPortraitViewport] = useState(() => isPortraitViewport());
  const [swipeDismissY, setSwipeDismissY] = useState(0);
  const [swipeDismissDragging, setSwipeDismissDragging] = useState(false);
  const [speedBoostVisible, setSpeedBoostVisible] = useState(false);

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
      if (typeof video.fastSeek === 'function') {
        try {
          video.fastSeek(next);
        } catch {
          video.currentTime = next;
        }
      } else {
        video.currentTime = next;
      }
      setCurrentTime(next);
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

  const triggerSeekRipple = useCallback((side, steps = 1) => {
    const burst = Date.now();
    setSeekRipple({ side, burst, steps });
    window.setTimeout(() => {
      setSeekRipple((prev) => (prev?.burst === burst ? null : prev));
    }, SEEK_RIPPLE_MS);
  }, []);

  const flashCenterTransport = useCallback((mode) => {
    const id = Date.now();
    setCenterFlash({ mode, id });
    if (centerFlashTimerRef.current) clearTimeout(centerFlashTimerRef.current);
    centerFlashTimerRef.current = window.setTimeout(() => {
      setCenterFlash((prev) => (prev?.id === id ? null : prev));
    }, CENTER_FLASH_MS);
  }, []);

  const toggleVideoTransport = useCallback(
    (flashOnPause = false) => {
      if (Date.now() - transportLockRef.current < TRANSPORT_LOCK_MS) return null;
      transportLockRef.current = Date.now();

      const video = videoRef.current;
      if (!video) return null;
      const wasPlaying = !video.paused;
      if (wasPlaying) {
        video.pause();
        setIsPlaying(false);
        if (flashOnPause) flashCenterTransport('pause');
      } else {
        video.play().catch(() => {});
        setIsPlaying(true);
      }
      bumpControlsVisible();
      return wasPlaying ? 'pause' : 'play';
    },
    [bumpControlsVisible, flashCenterTransport]
  );

  const enterPlaybackChrome = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage) return;

    const req =
      stage.requestFullscreen?.bind(stage)
      || stage.webkitRequestFullscreen?.bind(stage);

    if (req && !document.fullscreenElement) {
      try {
        await req();
      } catch {
        /* fall through to immersive */
      }
    }

    if (!document.fullscreenElement) {
      setImmersiveMode(true);
    }

    if (audioOnly) {
      await lockPortraitForPlayback();
    } else {
      await lockLandscapeForPlayback();
    }
  }, [audioOnly]);

  const resetSwipeDismiss = useCallback(() => {
    swipeDismissYRef.current = 0;
    setSwipeDismissY(0);
    setSwipeDismissDragging(false);
  }, []);

  const applySwipeDismissOffset = useCallback((dy) => {
    const offset = Math.max(0, dy);
    swipeDismissYRef.current = offset;
    setSwipeDismissY(offset);
    setSwipeDismissDragging(offset > 0);
  }, []);

  const handleVideoAreaSeek = useCallback(
    (side) => {
      const now = Date.now();
      const delta = side === 'left' ? -SEEK_STEP : SEEK_STEP;
      let steps = 1;
      if (
        seekStackRef.current.side === side
        && now - seekStackRef.current.burst < SEEK_STACK_MS
      ) {
        steps = seekStackRef.current.steps + 1;
      }
      seekStackRef.current = { side, burst: now, steps };
      seekBy(delta);
      triggerSeekRipple(side, steps);
    },
    [seekBy, triggerSeekRipple]
  );

  const clearTapGesture = useCallback(() => {
    if (tapGestureRef.current.pending) {
      clearTimeout(tapGestureRef.current.pending);
      tapGestureRef.current.pending = null;
    }
    tapGestureRef.current.lastAt = 0;
    tapGestureRef.current.lastSide = null;
  }, []);

  const cancelSpeedBoostHoldTimer = useCallback(() => {
    const boost = speedBoostRef.current;
    if (boost.timer) {
      clearTimeout(boost.timer);
      boost.timer = null;
    }
  }, []);

  const restorePlaybackRateUi = useCallback((rate) => {
    preferredPlaybackRateRef.current = rate;
    setPlaybackRate(rate);
  }, []);

  const resetSpeedBoost = useCallback(() => {
    cancelSpeedBoostHoldTimer();
    const boost = speedBoostRef.current;
    if (boost.active) {
      const video = videoRef.current;
      if (video) {
        video.playbackRate = boost.savedRate;
        restorePlaybackRateUi(boost.savedRate);
      }
    }
    boost.active = false;
    boost.touchId = null;
    setSpeedBoostVisible(false);
  }, [cancelSpeedBoostHoldTimer, restorePlaybackRateUi]);

  const endSpeedBoostGesture = useCallback(() => {
    const wasActive = speedBoostRef.current.active;
    if (wasActive) {
      const video = videoRef.current;
      const rate = speedBoostRef.current.savedRate;
      if (video) {
        video.playbackRate = rate;
      }
      restorePlaybackRateUi(rate);
    }
    cancelSpeedBoostHoldTimer();
    speedBoostRef.current.active = false;
    speedBoostRef.current.touchId = null;
    setSpeedBoostVisible(false);
    return wasActive;
  }, [cancelSpeedBoostHoldTimer, restorePlaybackRateUi]);

  const activateSpeedBoost = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused || video.ended) return;
    const boost = speedBoostRef.current;
    boost.savedRate = preferredPlaybackRateRef.current;
    boost.active = true;
    video.playbackRate = HOLD_2X_RATE;
    setSpeedBoostVisible(true);
    setShowControls(false);
    setShowSettings(false);
    clearTapGesture();
  }, [clearTapGesture]);

  const armSpeedBoostHold = useCallback(
    (touch) => {
      if (!IS_COARSE_POINTER || audioOnly) return;
      const video = videoRef.current;
      if (!video || video.paused || video.ended) return;

      cancelSpeedBoostHoldTimer();
      const boost = speedBoostRef.current;
      boost.startX = touch.clientX;
      boost.startY = touch.clientY;
      boost.touchId = touch.identifier;
      boost.active = false;
      boost.savedRate = preferredPlaybackRateRef.current;

      const touchId = touch.identifier;
      boost.timer = window.setTimeout(() => {
        boost.timer = null;
        if (boost.touchId !== touchId) return;
        activateSpeedBoost();
      }, HOLD_2X_MS);
    },
    [audioOnly, activateSpeedBoost, cancelSpeedBoostHoldTimer]
  );

  const handleVideoAreaClick = useCallback(
    (e) => {
      if (IS_COARSE_POINTER) return;
      if (Date.now() - lastTouchAtRef.current < TOUCH_CLICK_GUARD_MS) return;
      if (e.pointerType && e.pointerType !== 'mouse') return;
      togglePlay();
    },
    [togglePlay]
  );

  const videoTapZone = useCallback((x, width) => {
    if (x < width * 0.38) return 'left';
    if (x > width * 0.62) return 'right';
    return 'center';
  }, []);

  const preventVideoContextMenu = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleVideoTouchStart = useCallback(
    (e) => {
      if (e.touches.length !== 1) {
        resetSpeedBoost();
        return;
      }
      if (IS_COARSE_POINTER && !audioOnly) {
        const video = videoRef.current;
        if (video && !video.paused && !video.ended) {
          e.preventDefault();
        }
      }
      const rect = e.currentTarget.getBoundingClientRect();
      touchSessionRef.current = {
        controlsVisible: showControls,
        width: rect.width,
        startedPaused: !!videoRef.current?.paused,
      };
      armSpeedBoostHold(e.touches[0]);
      bumpControlsVisible();
    },
    [armSpeedBoostHold, audioOnly, bumpControlsVisible, resetSpeedBoost, showControls]
  );

  const handleVideoTouchMove = useCallback(
    (e) => {
      if (!IS_COARSE_POINTER || audioOnly) return;
      const boost = speedBoostRef.current;
      if (boost.touchId == null) return;

      if (boost.active || boost.touchId != null) {
        e.preventDefault();
      }

      if (e.touches.length !== 1) {
        if (boost.active) {
          endSpeedBoostGesture();
        } else {
          cancelSpeedBoostHoldTimer();
          boost.touchId = null;
        }
        return;
      }

      const touch = e.touches[0];
      if (touch.identifier !== boost.touchId) return;

      const dx = touch.clientX - boost.startX;
      const dy = touch.clientY - boost.startY;
      if (Math.hypot(dx, dy) < HOLD_2X_MOVE_CANCEL_PX) return;

      if (boost.active) return;

      cancelSpeedBoostHoldTimer();
      boost.touchId = null;
    },
    [audioOnly, cancelSpeedBoostHoldTimer, endSpeedBoostGesture]
  );

  const handleVideoTouchCancel = useCallback(
    (e) => {
      if (e.changedTouches.length !== 1) {
        resetSpeedBoost();
        return;
      }
      const touch = e.changedTouches[0];
      if (speedBoostRef.current.touchId === touch.identifier) {
        endSpeedBoostGesture();
      }
    },
    [endSpeedBoostGesture, resetSpeedBoost]
  );

  const handleStageSwipeTouchStartCapture = useCallback((e) => {
    if (!IS_COARSE_POINTER || e.touches.length !== 1) return;
    const touch = e.touches[0];
    swipeGestureRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      tracking: true,
      axisChosen: false,
      dismissing: false,
    };
  }, []);

  const handleStageSwipeTouchMove = useCallback(
    (e) => {
      if (!IS_COARSE_POINTER || e.touches.length !== 1) return;
      const swipe = swipeGestureRef.current;
      if (!swipe.tracking) return;

      const touch = e.touches[0];
      const dx = touch.clientX - swipe.startX;
      const dy = touch.clientY - swipe.startY;

      if (!swipe.axisChosen) {
        if (
          Math.abs(dx) < SWIPE_DISMISS_AXIS_PX
          && Math.abs(dy) < SWIPE_DISMISS_AXIS_PX
        ) {
          return;
        }
        swipe.axisChosen = true;
        if (dy > SWIPE_DISMISS_AXIS_PX && dy > Math.abs(dx) * 1.15) {
          swipe.dismissing = true;
          clearTapGesture();
          cancelSpeedBoostHoldTimer();
          if (speedBoostRef.current.active) {
            const video = videoRef.current;
            if (video) {
              const rate = speedBoostRef.current.savedRate;
              video.playbackRate = rate;
              restorePlaybackRateUi(rate);
            }
            speedBoostRef.current.active = false;
            speedBoostRef.current.touchId = null;
            setSpeedBoostVisible(false);
          }
        }
      }

      if (!swipe.dismissing || dy <= 0) return;

      e.preventDefault();
      applySwipeDismissOffset(dy);
    },
    [applySwipeDismissOffset, cancelSpeedBoostHoldTimer, clearTapGesture, restorePlaybackRateUi]
  );

  const handleStageSwipeTouchEndCapture = useCallback(
    (e) => {
      if (!IS_COARSE_POINTER || e.changedTouches.length !== 1) return;
      const swipe = swipeGestureRef.current;
      if (!swipe.tracking) return;

      swipe.tracking = false;

      if (swipe.dismissing) {
        const offset = swipeDismissYRef.current;
        swipe.dismissing = false;
        swipe.axisChosen = false;
        if (offset >= SWIPE_DISMISS_CLOSE_PX) {
          resetSwipeDismiss();
          onClose();
          return;
        }
        resetSwipeDismiss();
      }
    },
    [onClose, resetSwipeDismiss]
  );

  const handleVideoTouchEnd = useCallback(
    (e) => {
      if (e.changedTouches.length !== 1) return;
      lastTouchAtRef.current = Date.now();

      const touch = e.changedTouches[0];
      if (speedBoostRef.current.touchId === touch.identifier) {
        const wasBoosting = endSpeedBoostGesture();
        if (wasBoosting) {
          e.preventDefault();
          return;
        }
        cancelSpeedBoostHoldTimer();
        speedBoostRef.current.touchId = null;
      }

      if (IS_COARSE_POINTER && swipeGestureRef.current.dismissing) {
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const width = rect.width || touchSessionRef.current.width || 1;
      const zone = videoTapZone(x, width);
      const now = Date.now();

      if (
        zone !== 'center'
        && now - tapGestureRef.current.lastAt < DOUBLE_TAP_MS
        && tapGestureRef.current.lastSide === zone
      ) {
        clearTapGesture();
        e.preventDefault();
        handleVideoAreaSeek(zone);
        return;
      }

      const { controlsVisible, startedPaused } = touchSessionRef.current;

      if (zone === 'center' && controlsVisible && !startedPaused) {
        clearTapGesture();
        e.preventDefault();
        toggleVideoTransport(true);
        tapGestureRef.current.lastAt = now;
        tapGestureRef.current.lastSide = zone;
        return;
      }

      if (zone === 'center') {
        e.preventDefault();
      }

      tapGestureRef.current.lastAt = now;
      tapGestureRef.current.lastSide = zone;

      if (tapGestureRef.current.pending) clearTimeout(tapGestureRef.current.pending);
      tapGestureRef.current.pending = window.setTimeout(() => {
        tapGestureRef.current.pending = null;
        tapGestureRef.current.lastAt = 0;
        tapGestureRef.current.lastSide = null;
        bumpControlsVisible();
      }, DOUBLE_TAP_MS);
    },
    [
      bumpControlsVisible,
      cancelSpeedBoostHoldTimer,
      clearTapGesture,
      endSpeedBoostGesture,
      handleVideoAreaSeek,
      toggleVideoTransport,
      videoTapZone,
    ]
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
        if (audioOnly) {
          await lockPortraitForPlayback();
        } else {
          await lockLandscapeForPlayback();
        }
        bumpControlsVisible();
        return;
      } catch {
        /* fall through to immersive */
      }
    }

    setImmersiveMode(true);
    if (audioOnly) {
      await lockPortraitForPlayback();
    } else {
      await lockLandscapeForPlayback();
    }
    bumpControlsVisible();
  }, [audioOnly, bumpControlsVisible, immersiveMode]);

  const setRate = useCallback(
    (rate) => {
      const video = videoRef.current;
      if (!video) return;
      preferredPlaybackRateRef.current = rate;
      video.playbackRate = rate;
      setPlaybackRate(rate);
      setShowSettings(false);
      bumpControlsVisible();
    },
    [bumpControlsVisible]
  );

  const adjustPlaybackRate = useCallback(
    (delta) => {
      const video = videoRef.current;
      if (!video) return;
      const min = PLAYBACK_RATES[0];
      const max = PLAYBACK_RATES[PLAYBACK_RATES.length - 1];
      const next = Math.min(
        max,
        Math.max(min, Math.round((video.playbackRate + delta) * 4) / 4)
      );
      setRate(next);
    },
    [setRate]
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
      resetSpeedBoost();
      setSeekRipple(null);
      setCenterFlash(null);
      unlockPlaybackOrientation();
      resetSwipeDismiss();
      if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      document.body.classList.remove('yt-player-open');
      return undefined;
    }
    document.body.classList.add('yt-player-open');
    return () => {
      document.body.classList.remove('yt-player-open');
      unlockPlaybackOrientation();
    };
  }, [open, clearTapGesture, resetSpeedBoost, resetSwipeDismiss]);

  useEffect(() => {
    if (!open || !IS_COARSE_POINTER) return undefined;
    const mq = window.matchMedia('(orientation: portrait)');
    const sync = () => setPortraitViewport(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    void enterPlaybackChrome();
    return undefined;
  }, [open, enterPlaybackChrome]);

  useEffect(() => {
    if (!open || !IS_COARSE_POINTER) return undefined;
    const el = stageRef.current;
    if (!el) return undefined;
    const onMove = (e) => handleStageSwipeTouchMove(e);
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => el.removeEventListener('touchmove', onMove);
  }, [open, handleStageSwipeTouchMove]);

  useEffect(() => {
    if (!open || !IS_COARSE_POINTER) return undefined;
    const el = touchGestureRef.current;
    if (!el) return undefined;
    const onMove = (e) => handleVideoTouchMove(e);
    const onStartCapture = (e) => {
      if (audioOnly || e.touches.length !== 1) return;
      const video = videoRef.current;
      if (video && !video.paused && !video.ended) {
        e.preventDefault();
      }
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchstart', onStartCapture, { passive: false, capture: true });
    return () => {
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchstart', onStartCapture, { capture: true });
    };
  }, [open, audioOnly, handleVideoTouchMove]);

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
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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
          e.preventDefault();
          seekBy(-SEEK_STEP);
          break;
        case 'ArrowRight':
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
        case '<':
          e.preventDefault();
          adjustPlaybackRate(-0.25);
          break;
        case '>':
          e.preventDefault();
          adjustPlaybackRate(0.25);
          break;
        case '0':
          e.preventDefault();
          seekToFraction(0);
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          e.preventDefault();
          seekToFraction(Number(e.key) * 0.1);
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
  }, [
    open,
    immersiveMode,
    togglePlay,
    toggleFullscreen,
    toggleMute,
    seekBy,
    seekToFraction,
    changeVolume,
    adjustPlaybackRate,
    volume,
    onClose,
  ]);

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
      const boost = speedBoostRef.current;
      if (boost.active) {
        setPlaybackRate(boost.savedRate);
      } else if (video.playbackRate === HOLD_2X_RATE) {
        setPlaybackRate(preferredPlaybackRateRef.current);
      } else {
        preferredPlaybackRateRef.current = video.playbackRate;
        setPlaybackRate(video.playbackRate);
      }
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
        setIsPreparing(true);
        const preparePromise = preparePlaybackRef.current
          ? preparePlaybackRef.current()
          : Promise.resolve();
        const canStartImmediately =
          isStreamUrl(streamUrl) && !!navigator.serviceWorker?.controller;

        if (canStartImmediately && !cancelled) {
          setSrc(streamUrl);
          bumpControlsVisible();
        }

        await preparePromise;
        if (cancelled) return;

        if (!canStartImmediately) {
          setSrc(streamUrl);
          bumpControlsVisible();
        }
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
  const swipeBackdropOpacity =
    swipeDismissY > 0 ? Math.max(0.2, 1 - swipeDismissY / 480) : undefined;

  return (
    <div
      className="yt-player-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      style={swipeBackdropOpacity != null ? { opacity: swipeBackdropOpacity } : undefined}
    >
      <div
        ref={stageRef}
        className={`yt-player-stage${isFullscreen ? ' yt-player-stage--fullscreen' : ''}${
          immersiveMode ? ' yt-player-stage--immersive' : ''
        }${audioOnly ? ' yt-player-stage--audio' : ''}${
          showControls ? ' yt-player-stage--controls-visible' : ''
        }${swipeDismissDragging ? ' yt-player-stage--swipe-dismiss' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onMouseMove={bumpControlsVisible}
        onTouchStart={bumpControlsVisible}
        onTouchStartCapture={handleStageSwipeTouchStartCapture}
        onTouchEndCapture={handleStageSwipeTouchEndCapture}
        style={
          swipeDismissY > 0
            ? {
                transform: `translateY(${swipeDismissY}px) scale(${
                  Math.max(0.88, 1 - swipeDismissY / 1200)
                })`,
                opacity: Math.max(0.55, 1 - swipeDismissY / 520),
              }
            : undefined
        }
      >
        {!audioOnly && IS_COARSE_POINTER && portraitViewport ? (
          <div className="yt-player-rotate-hint" aria-live="polite">
            <span className="yt-player-rotate-hint__icon" aria-hidden>
              ↻
            </span>
            Rotate your phone sideways for full-screen playback
          </div>
        ) : null}
        <div className="yt-player-topbar" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="yt-player-topbtn yt-player-topbtn--close"
            onClick={onClose}
            aria-label="Close player"
          >
            <FaTimes />
          </button>
          <div className="yt-player-settings-wrap yt-player-settings-wrap--top">
            <button
              type="button"
              className="yt-player-topbtn yt-player-topbtn--settings"
              onClick={() => setShowSettings((s) => !s)}
              aria-expanded={showSettings}
              aria-label="Playback speed"
            >
              <FaCog />
              {playbackRate !== 1 ? (
                <span className="yt-player-rate-label">{playbackRate}×</span>
              ) : null}
            </button>
            {showSettings ? (
              <ul className="yt-player-settings-menu yt-player-settings-menu--top" role="menu">
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
        </div>

        <button
          type="button"
          className="yt-player-close yt-player-close--desktop"
          onClick={onClose}
          aria-label="Close player"
        >
          <FaTimes />
        </button>

        <div
          className={`yt-player-video-wrap${audioOnly ? ' yt-player-video-wrap--audio' : ''}`}
          onContextMenu={preventVideoContextMenu}
          role="presentation"
        >
          {audioOnly ? (
            <div className="yt-player-audio-panel" aria-hidden={isPlaying}>
              <FaMusic className="yt-player-audio-icon" />
              <p className="yt-player-audio-title" title={title}>
                {title}
              </p>
            </div>
          ) : null}
          <div className="yt-player-video-container" aria-hidden>
            <video
              ref={videoRef}
              className={`yt-player-video${audioOnly ? ' yt-player-video--audio' : ''}`}
              playsInline
              disablePictureInPicture
              controlsList="nodownload noremoteplayback"
              onContextMenu={preventVideoContextMenu}
            />
          </div>

          <div
            ref={touchGestureRef}
            className="yt-player-touch-gesture"
            aria-hidden
            onClick={handleVideoAreaClick}
            onTouchStart={handleVideoTouchStart}
            onTouchEnd={handleVideoTouchEnd}
            onTouchCancel={handleVideoTouchCancel}
            onDoubleClick={swallowVideoDoubleClick}
            onContextMenu={preventVideoContextMenu}
          />

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
              onTouchStart={(e) => {
                e.stopPropagation();
                lastTouchAtRef.current = Date.now();
              }}
              onTouchEnd={(e) => {
                e.preventDefault();
                e.stopPropagation();
                lastTouchAtRef.current = Date.now();
                clearTapGesture();
                toggleVideoTransport(false);
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (IS_COARSE_POINTER) return;
                clearTapGesture();
                toggleVideoTransport(false);
              }}
              aria-label="Play"
            >
              <FaPlay />
            </button>
          ) : null}

          {centerFlash?.mode === 'pause' ? (
            <div className="yt-player-center-flash yt-player-center-flash--pause" key={centerFlash.id} aria-hidden>
              <span className="yt-player-pause-bar" />
              <span className="yt-player-pause-bar" />
            </div>
          ) : null}

          {speedBoostVisible ? (
            <div
              className="yt-player-speed-boost"
              aria-live="polite"
              aria-label="Playing at 2x speed"
            >
              2x
            </div>
          ) : null}

          {seekRipple ? (
            <div
              className={`yt-player-seek-ripple yt-player-seek-ripple--${seekRipple.side}`}
              key={seekRipple.burst}
              aria-hidden
            >
              <span className="yt-player-seek-ripple-ring" />
              <span className="yt-player-seek-ripple-arrows" aria-hidden>
                {Array.from({ length: seekRipple.steps || 1 }, (_, i) => (
                  <span key={`${seekRipple.burst}-${i}`} className="yt-player-seek-ripple-arrow" />
                ))}
              </span>
              <span className="yt-player-seek-ripple-label">
                {seekRipple.side === 'left' ? '−' : '+'}
                {(seekRipple.steps || 1) * SEEK_STEP} seconds
              </span>
            </div>
          ) : null}

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
            onTouchStart={(e) => {
              if (e.touches.length !== 1) return;
              scrubbingRef.current = true;
              const rect = e.currentTarget.getBoundingClientRect();
              handleProgressPointer(e.touches[0].clientX, rect);
            }}
            onTouchMove={(e) => {
              if (!scrubbingRef.current || e.touches.length !== 1) return;
              const rect = e.currentTarget.getBoundingClientRect();
              handleProgressPointer(e.touches[0].clientX, rect);
            }}
            onTouchEnd={() => {
              scrubbingRef.current = false;
              setScrubPreview(null);
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
              <button
                type="button"
                className="yt-player-btn yt-player-btn--transport"
                onClick={(e) => {
                  if (IS_COARSE_POINTER) {
                    e.preventDefault();
                    lastTouchAtRef.current = Date.now();
                  }
                  if (!IS_COARSE_POINTER && Date.now() - lastTouchAtRef.current < TOUCH_CLICK_GUARD_MS) {
                    return;
                  }
                  toggleVideoTransport(false);
                }}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <FaPause /> : <FaPlay />}
              </button>

              <div className="yt-player-volume yt-player-volume--desktop">
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
              <div className="yt-player-settings-wrap yt-player-settings-wrap--bottom">
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