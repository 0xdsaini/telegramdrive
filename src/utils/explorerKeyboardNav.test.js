import {
  buildExplorerGridItems,
  clampIndex,
  interpretExplorerKey,
  moveSelection,
  selectionIndexAfterPathChange,
  shouldIgnoreExplorerShortcuts,
} from './explorerKeyboardNav';

describe('buildExplorerGridItems', () => {
  it('orders folders before files', () => {
    const items = buildExplorerGridItems({
      subfolders: [{ name: 'a' }, { name: 'b' }],
      files: [{ filename: 'x.txt' }],
    });
    expect(items.map((i) => i.key)).toEqual(['folder:a', 'folder:b', 'file:x.txt']);
  });
});

describe('moveSelection', () => {
  it('clamps at bounds', () => {
    expect(moveSelection(-1, 0, 3)).toBe(0);
    expect(moveSelection(1, 2, 3)).toBe(2);
    expect(moveSelection(1, null, 3)).toBe(0);
  });
});

describe('interpretExplorerKey', () => {
  const evt = (overrides) => ({ key: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...overrides });

  it('maps navigation keys', () => {
    expect(interpretExplorerKey(evt({ key: 'ArrowDown' }))).toBe('next');
    expect(interpretExplorerKey(evt({ key: 'ArrowLeft' }))).toBe('prev');
    expect(interpretExplorerKey(evt({ key: 'Enter' }))).toBe('openItem');
    expect(interpretExplorerKey(evt({ key: 'Escape' }))).toBe('clearSelection');
    expect(interpretExplorerKey(evt({ key: 'Backspace' }))).toBe('goParent');
    expect(interpretExplorerKey(evt({ key: 'ArrowDown', metaKey: true }))).toBe('cmdOpenItem');
    expect(interpretExplorerKey(evt({ key: 'ArrowUp', ctrlKey: true }))).toBe('goParent');
  });
});

describe('shouldIgnoreExplorerShortcuts', () => {
  it('ignores when stream or panel open', () => {
    const e = { target: document.createElement('div') };
    expect(shouldIgnoreExplorerShortcuts(e, { streamOpen: true })).toBe(true);
    expect(shouldIgnoreExplorerShortcuts(e, { untrackedPanelOpen: true })).toBe(true);
  });
});

describe('clampIndex', () => {
  it('returns null for empty', () => {
    expect(clampIndex(0, 0)).toBe(null);
  });
});

describe('selectionIndexAfterPathChange', () => {
  const photosFolderItems = buildExplorerGridItems({
    subfolders: [{ name: '2024' }, { name: '2023' }],
    files: [],
  });

  it('highlights the exited folder when going up one level', () => {
    expect(selectionIndexAfterPathChange('/Photos/2024', '/Photos', photosFolderItems)).toBe(0);
  });

  it('highlights the correct folder when jumping up via breadcrumb', () => {
    const rootItems = buildExplorerGridItems({
      subfolders: [{ name: 'a' }, { name: 'b' }],
      files: [],
    });
    expect(selectionIndexAfterPathChange('/a/b/c', '/a', rootItems)).toBe(1);
    expect(selectionIndexAfterPathChange('/a/b/c', '/', rootItems)).toBe(0);
  });

  it('clears selection when entering a child folder', () => {
    expect(selectionIndexAfterPathChange('/Photos', '/Photos/2024', photosFolderItems)).toBe(null);
  });
});