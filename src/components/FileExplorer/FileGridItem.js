import React, { useEffect, useRef, useState } from 'react';
import { FaDownload, FaTrash, FaEllipsisV, FaPlay } from 'react-icons/fa';

const FileGridItem = ({
  filename,
  currentPath,
  isVideo,
  isStreamable,
  keyboardSelected = false,
  itemRef,
  onSelect,
  onPlay,
  onDownload,
  onDelete,
  poster,
  icon,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const draggedRef = useRef(false);

  const dragData = `file:${currentPath === '/' ? `/${filename}` : `${currentPath}/${filename}`}`;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const handlePlay = (e) => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (onPlay) onPlay(filename, e);
  };

  const classNames = [
    'file-item',
    isVideo ? 'file-item--video' : '',
    isStreamable && !isVideo ? 'file-item--media' : '',
    keyboardSelected ? 'file-item--keyboard-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleCardClick = (e) => {
    onSelect?.();
    if (isStreamable) {
      handlePlay(e);
    }
  };

  return (
    <div
      ref={itemRef}
      className={classNames}
      aria-selected={keyboardSelected || undefined}
      aria-label={isStreamable ? `Play ${filename}` : filename}
      draggable
      onDragStart={(e) => {
        draggedRef.current = true;
        e.dataTransfer.setData('text/plain', dragData);
      }}
      onDragEnd={() => {
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      onClick={handleCardClick}
    >
      <div className="file-card-menu" ref={menuRef}>
        <button
          type="button"
          className="file-card-menu-trigger"
          title="More actions"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
        >
          <FaEllipsisV aria-hidden />
        </button>
        {menuOpen && (
          <div className="file-card-menu-panel" role="menu">
            {isStreamable ? (
              <button
                type="button"
                role="menuitem"
                className="file-card-menu-item"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  handlePlay(e);
                }}
              >
                <FaPlay aria-hidden />
                Play
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              className="file-card-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDownload(filename, e);
              }}
            >
              <FaDownload aria-hidden />
              Download
            </button>
            <button
              type="button"
              role="menuitem"
              className="file-card-menu-item file-card-menu-item--danger"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete(filename, e);
              }}
            >
              <FaTrash aria-hidden />
              Delete
            </button>
          </div>
        )}
      </div>

      {isVideo ? (
        <div className="video-card-shell">
          {poster || <div className="file-item-icon-wrap file-item-icon-wrap--fallback">{icon}</div>}
          {isStreamable && (
            <span className="video-card-hover-play" aria-hidden>
              <FaPlay />
            </span>
          )}
        </div>
      ) : (
        <div className="file-item-icon-wrap file-item-media-shell">
          {icon}
          {isStreamable && (
            <span className="video-card-hover-play video-card-hover-play--audio" aria-hidden>
              <FaPlay />
            </span>
          )}
        </div>
      )}

      <span className="file-name" title={filename}>
        {filename}
      </span>
    </div>
  );
};

export default FileGridItem;