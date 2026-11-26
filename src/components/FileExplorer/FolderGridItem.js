import React, { useEffect, useRef, useState } from 'react';
import { FaFolder, FaEllipsisV, FaTrash, FaEdit } from 'react-icons/fa';

const FolderGridItem = ({
  folderName,
  currentPath,
  keyboardSelected = false,
  itemRef,
  onSelect,
  onOpen,
  onRename,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const draggedRef = useRef(false);

  const dragData = `folder:${currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`}`;

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

  const classNames = [
    'file-item',
    'folder-item',
    keyboardSelected ? 'file-item--keyboard-selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleCardClick = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    onSelect?.();
    onOpen?.(folderName);
  };

  return (
    <div
      ref={itemRef}
      className={classNames}
      aria-selected={keyboardSelected || undefined}
      aria-label={`Folder ${folderName}`}
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
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
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
            <button
              type="button"
              role="menuitem"
              className="file-card-menu-item"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onRename(folderName, e);
              }}
            >
              <FaEdit aria-hidden />
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className="file-card-menu-item file-card-menu-item--danger"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete(folderName, e);
              }}
            >
              <FaTrash aria-hidden />
              Delete
            </button>
          </div>
        )}
      </div>

      <FaFolder style={{ fontSize: '42px', color: '#0088cc' }} />
      <span className="file-name" title={folderName}>
        {folderName}
      </span>
    </div>
  );
};

export default FolderGridItem;