import React, { useEffect, useRef, useState } from 'react';
import { FaDownload, FaTrash, FaEllipsisV, FaPlay, FaExternalLinkAlt } from 'react-icons/fa';

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
  onOpenInNewTab,
  poster,
  icon,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
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

  useEffect(() => {
    if (!contextMenu) return undefined;
    const close = () => setContextMenu(null);
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', close, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

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

  const handleOpenInNewTab = (e) => {
    e?.stopPropagation?.();
    setMenuOpen(false);
    setContextMenu(null);
    onOpenInNewTab?.(filename, e);
  };

  const handleContextMenu = (e) => {
    if (!isStreamable || !onOpenInNewTab) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  return (
    <div
      ref={itemRef}
      className={classNames}
      aria-selected={keyboardSelected || undefined}
      aria-label={isStreamable ? `Play ${filename}` : filename}
      onContextMenu={handleContextMenu}
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
              <>
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
                <button
                  type="button"
                  role="menuitem"
                  className="file-card-menu-item"
                  onClick={handleOpenInNewTab}
                >
                  <FaExternalLinkAlt aria-hidden />
                  Open in new tab
                </button>
              </>
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

      {contextMenu ? (
        <div
          className="file-card-menu-panel file-card-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button type="button" role="menuitem" className="file-card-menu-item" onClick={handleOpenInNewTab}>
            <FaExternalLinkAlt aria-hidden />
            Open in new tab
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default FileGridItem;