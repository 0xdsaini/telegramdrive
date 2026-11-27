import React, { useEffect, useState } from 'react';
import { getActiveSubtitleCueLines } from '../../utils/activeSubtitleCue';

function VideoSubtitleOverlay({ videoRef, enabled }) {
  const [lines, setLines] = useState([]);

  useEffect(() => {
    if (!enabled) {
      setLines([]);
      return undefined;
    }

    const video = videoRef.current;
    if (!video) return undefined;

    const sync = () => {
      setLines(getActiveSubtitleCueLines(video));
    };

    const bindTrack = (track) => {
      if (track.kind !== 'subtitles' && track.kind !== 'captions') return;
      track.addEventListener('cuechange', sync);
    };

    const unbindTrack = (track) => {
      if (track.kind !== 'subtitles' && track.kind !== 'captions') return;
      track.removeEventListener('cuechange', sync);
    };

    const onAddTrack = (event) => {
      bindTrack(event.track);
      sync();
    };

    const textTracks = video.textTracks;
    for (let i = 0; i < textTracks.length; i += 1) {
      bindTrack(textTracks[i]);
    }
    textTracks.addEventListener('addtrack', onAddTrack);
    textTracks.addEventListener('change', sync);
    video.addEventListener('timeupdate', sync);

    sync();

    return () => {
      for (let i = 0; i < textTracks.length; i += 1) {
        unbindTrack(textTracks[i]);
      }
      textTracks.removeEventListener('addtrack', onAddTrack);
      textTracks.removeEventListener('change', sync);
      video.removeEventListener('timeupdate', sync);
    };
  }, [videoRef, enabled]);

  if (!enabled || lines.length === 0) return null;

  return (
    <div
      className="yt-player-subtitle-overlay"
      aria-live="off"
      aria-hidden={false}
      role="doc-subtitle"
    >
      {lines.map((line, index) => (
        <p key={`${index}-${line}`} className="yt-player-subtitle-line">
          {line}
        </p>
      ))}
    </div>
  );
}

export default VideoSubtitleOverlay;