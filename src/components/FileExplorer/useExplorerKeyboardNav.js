import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildExplorerGridItems,
  gridItemsSignature,
  interpretExplorerKey,
  moveSelection,
  shouldIgnoreExplorerShortcuts,
} from '../../utils/explorerKeyboardNav';

export function useExplorerKeyboardNav({
  currentFolder,
  currentPath,
  onOpenFolder,
  onOpenFile,
  onGoParent,
  streamOpen,
  untrackedPanelOpen,
}) {
  const items = useMemo(() => buildExplorerGridItems(currentFolder), [currentFolder]);
  const itemsSig = useMemo(() => gridItemsSignature(items), [items]);

  const [selectedIndex, setSelectedIndex] = useState(null);
  const itemRefs = useRef([]);
  const selectedIndexRef = useRef(selectedIndex);
  const itemsRef = useRef(items);

  selectedIndexRef.current = selectedIndex;
  itemsRef.current = items;

  useEffect(() => {
    setSelectedIndex(null);
  }, [currentPath, itemsSig]);

  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, items.length);
  }, [items.length]);

  useEffect(() => {
    if (selectedIndex == null || selectedIndex < 0 || selectedIndex >= items.length) {
      return;
    }
    const el = itemRefs.current[selectedIndex];
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [selectedIndex, items.length]);

  const setItemRef = useCallback((index) => {
    return (el) => {
      itemRefs.current[index] = el;
    };
  }, []);

  const selectIndex = useCallback((index) => {
    setSelectedIndex(index);
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (
        shouldIgnoreExplorerShortcuts(event, {
          streamOpen,
          untrackedPanelOpen,
        })
      ) {
        return;
      }

      const action = interpretExplorerKey(event);
      if (!action) {
        return;
      }

      const gridItems = itemsRef.current;
      const length = gridItems.length;

      if (action === 'prev' || action === 'next') {
        if (length === 0) {
          return;
        }
        event.preventDefault();
        const delta = action === 'next' ? 1 : -1;
        setSelectedIndex((prev) => moveSelection(delta, prev, length));
        return;
      }

      const openSelectedItem = () => {
        const idx = selectedIndexRef.current;
        if (idx == null || idx < 0 || idx >= length) {
          return false;
        }
        const item = gridItems[idx];
        if (!item) {
          return false;
        }
        if (item.type === 'folder') {
          onOpenFolder?.(item.name);
        } else {
          onOpenFile?.(item.name);
        }
        return true;
      };

      if (action === 'cmdOpenItem') {
        if (length === 0) {
          return;
        }
        event.preventDefault();
        if (selectedIndexRef.current == null) {
          setSelectedIndex(0);
          return;
        }
        openSelectedItem();
        return;
      }

      if (action === 'openItem') {
        if (length === 0) {
          return;
        }
        const idx = selectedIndexRef.current;
        if (idx == null || idx < 0 || idx >= length) {
          return;
        }
        event.preventDefault();
        openSelectedItem();
        return;
      }

      if (action === 'clearSelection') {
        if (selectedIndexRef.current == null) {
          return;
        }
        event.preventDefault();
        setSelectedIndex(null);
        return;
      }

      if (action === 'goParent') {
        if (currentPath === '/') {
          return;
        }
        event.preventDefault();
        onGoParent?.();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [streamOpen, untrackedPanelOpen, currentPath, onOpenFolder, onOpenFile, onGoParent]);

  return {
    selectedIndex,
    setSelectedIndex: selectIndex,
    setItemRef,
    gridItems: items,
  };
}