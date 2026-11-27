import React, { useEffect, useRef, useState } from 'react';
import { FaDownload, FaTrash, FaEllipsisV, FaPlay } from 'react-icons/fa';

function shouldLetBrowserNavigate(e) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1;
}

const FileGridItem = ({
  filename,
  currentPath,
  isVideo,
  isStreamable,
  keyboardSelected = false,
  itemRef,
  fileHref,
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
    fileHref ? 'file-item--link' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleCardClick = (e) => {
    onSelect?.();
    if (isStreamable) {
      handlePlay(e);
    }
  };

  const handleRootClick = (e) => {
    if (fileHref && shouldLetBrowserNavigate(e)) {
      return;
    }
    if (fileHref) {
      e.preventDefault();
    }
    handleCardClick(e);
  };

  const sharedProps = {
    ref: itemRef,
    className: classNames,
    'aria-selected': keyboardSelected || undefined,
    'aria-label': isStreamable ? `Play ${filename}` : filename,
    draggable: true,
    onDragStart: (e) => {
      draggedRef.current = true;
      e.dataTransfer.setData('text/plain', dragData);
    },
    onDragEnd: () => {
      setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    },
    onClick: handleRootClick,
  };

  const Root = fileHref ? 'a' : 'div';
  const rootProps = fileHref ? { ...sharedProps, href: fileHref } : sharedProps;

  return (
    <Root {...rootProps}>
      <div className="file-card-menu" ref={menuRef}>
        <button
          type="button"
          className="file-card-menu-trigger"
          title="More actions"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
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
                  e.preventDefault();
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
                e.preventDefault();
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
                e.preventDefault();
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
    </Root>
  );
};

export default FileGridItem;