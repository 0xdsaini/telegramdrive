import React, { useEffect, useState } from 'react';
import {
  getActiveSubtitleCueLines,
  subtitleTextToLines,
} from '../../utils/activeSubtitleCue';
import { findParsedVttCueAtTime, parseWebVttCues } from '../../utils/parseWebVttCues';

function VideoSubtitleOverlay({ videoRef, enabled, subtitleVttText, open }) {
  const [parsedCues, setParsedCues] = useState([]);
  const [lines, setLines] = useState([]);

  useEffect(() => {
    if (!open || !subtitleVttText) {
      setParsedCues([]);
      return undefined;
    }
    setParsedCues(parseWebVttCues(subtitleVttText));
    return undefined;
  }, [open, subtitleVttText]);

  useEffect(() => {
    if (!enabled || !open) {
      setLines([]);
      return undefined;
    }

    const video = videoRef.current;
    if (!video) return undefined;

    const useSidecar = parsedCues.length > 0;

    const sync = () => {
      if (useSidecar) {
        const cue = findParsedVttCueAtTime(parsedCues, video.currentTime);
        setLines(cue ? subtitleTextToLines(cue.text) : []);
        return;
      }
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
    video.addEventListener('seeked', sync);
    video.addEventListener('loadeddata', sync);
    video.addEventListener('playing', sync);

    sync();

    return () => {
      for (let i = 0; i < textTracks.length; i += 1) {
        unbindTrack(textTracks[i]);
      }
      textTracks.removeEventListener('addtrack', onAddTrack);
      textTracks.removeEventListener('change', sync);
      video.removeEventListener('timeupdate', sync);
      video.removeEventListener('seeked', sync);
      video.removeEventListener('loadeddata', sync);
      video.removeEventListener('playing', sync);
    };
  }, [videoRef, enabled, open, parsedCues, subtitleVttText]);

  if (!enabled || lines.length === 0) return null;

  return (
    <div
      className="yt-player-subtitle-overlay"
      aria-live="off"
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