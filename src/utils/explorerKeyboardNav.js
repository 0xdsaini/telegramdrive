const FOCUSABLE_FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);

/**
 * Flat grid order: subfolders first, then files (matches FileExplorer render).
 */
export function buildExplorerGridItems(currentFolder) {
  if (!currentFolder) {
    return [];
  }

  const items = [];

  if (currentFolder.subfolders && Array.isArray(currentFolder.subfolders)) {
    for (const folder of currentFolder.subfolders) {
      items.push({
        type: 'folder',
        name: folder.name,
        key: `folder:${folder.name}`,
      });
    }
  }

  if (currentFolder.files && Array.isArray(currentFolder.files)) {
    for (const file of currentFolder.files) {
      items.push({
        type: 'file',
        name: file.filename,
        key: `file:${file.filename}`,
      });
    }
  }

  return items;
}

export function gridItemsSignature(items) {
  return items.map((item) => item.key).join('\0');
}

export function pathSegments(path) {
  if (!path || path === '/') {
    return [];
  }
  return path.split('/').filter(Boolean);
}

/**
 * Finder-style selection after changing folders: highlight the folder you left
 * when navigating up; clear when entering a child folder.
 * @returns {number|null|undefined} index to select, null to clear, undefined if path unchanged
 */
export function selectionIndexAfterPathChange(oldPath, newPath, items) {
  if (oldPath === newPath) {
    return undefined;
  }

  const oldSegs = pathSegments(oldPath);
  const newSegs = pathSegments(newPath);

  if (newSegs.length < oldSegs.length) {
    const folderName = oldSegs[newSegs.length];
    if (!folderName) {
      return null;
    }
    const key = `folder:${folderName}`;
    const idx = items.findIndex((item) => item.key === key);
    return idx >= 0 ? idx : null;
  }

  if (newSegs.length > oldSegs.length) {
    return null;
  }

  return null;
}

export function selectionIndexForItemKey(items, key) {
  if (!key) {
    return null;
  }
  const idx = items.findIndex((item) => item.key === key);
  return idx >= 0 ? idx : null;
}

export function clampIndex(index, length) {
  if (length <= 0) {
    return null;
  }
  if (index == null || Number.isNaN(index)) {
    return 0;
  }
  return Math.max(0, Math.min(index, length - 1));
}

export function moveSelection(delta, index, length) {
  if (length <= 0) {
    return null;
  }
  const base = index == null ? (delta > 0 ? -1 : 0) : index;
  return clampIndex(base + delta, length);
}

export function shouldIgnoreExplorerShortcuts(event, { streamOpen, untrackedPanelOpen } = {}) {
  if (streamOpen || untrackedPanelOpen) {
    return true;
  }
  if (event?.defaultPrevented) {
    return true;
  }

  const target = event?.target;
  if (!target || typeof target !== 'object') {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tag = target.tagName;
  if (FOCUSABLE_FORM_TAGS.has(tag)) {
    return true;
  }

  if (target.closest?.('.file-card-menu-panel')) {
    return true;
  }

  return false;
}

/**
 * @returns {'prev'|'next'|'openItem'|'cmdOpenItem'|'goParent'|'clearSelection'|null}
 */
export function interpretExplorerKey(event) {
  const key = event?.key;
  if (!key) {
    return null;
  }

  const mod = Boolean(event.metaKey || event.ctrlKey);

  if (mod && (key === 'ArrowDown' || key === 'Down')) {
    return 'cmdOpenItem';
  }
  if (mod && (key === 'ArrowUp' || key === 'Up')) {
    return 'goParent';
  }

  if (key === 'Enter' && !mod && !event.shiftKey && !event.altKey) {
    return 'openItem';
  }
  if (key === 'Escape' && !mod) {
    return 'clearSelection';
  }
  if (key === 'Backspace' && !mod && !event.shiftKey && !event.altKey) {
    return 'goParent';
  }

  if (key === 'ArrowUp' || key === 'ArrowLeft') {
    return 'prev';
  }
  if (key === 'ArrowDown' || key === 'ArrowRight') {
    return 'next';
  }

  return null;
}