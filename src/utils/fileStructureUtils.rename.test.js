import {
  addFile,
  createEmptyFileStructure,
  createFolder,
  findFolderByPath,
  renameFile,
  renameFolder,
} from './fileStructureUtils';

describe('renameFolder', () => {
  it('renames a folder under the root', () => {
    let tree = createEmptyFileStructure();
    tree = createFolder(tree, '/', 'old');
    tree = renameFolder(tree, '/old', 'new');

    expect(findFolderByPath(tree, '/new')).not.toBeNull();
    expect(findFolderByPath(tree, '/old')).toBeNull();
    expect(findFolderByPath(tree, '/new').name).toBe('new');
  });

  it('rejects duplicate sibling names', () => {
    let tree = createEmptyFileStructure();
    tree = createFolder(tree, '/', 'a');
    tree = createFolder(tree, '/', 'b');
    const after = renameFolder(tree, '/a', 'b');

    expect(findFolderByPath(after, '/a')).not.toBeNull();
    expect(findFolderByPath(after, '/b')).not.toBeNull();
  });

  it('preserves nested contents after rename', () => {
    let tree = createEmptyFileStructure();
    tree = createFolder(tree, '/', 'parent');
    tree = createFolder(tree, '/parent', 'child');
    tree = renameFolder(tree, '/parent', 'renamed');

    expect(findFolderByPath(tree, '/renamed/child')).not.toBeNull();
  });
});

describe('renameFile', () => {
  it('renames a file and keeps message_id and inode', () => {
    let tree = createEmptyFileStructure();
    tree = addFile(tree, '/', 'old.mp4', 4242);
    tree = renameFile(tree, '/', 'old.mp4', 'new.mp4');

    const root = findFolderByPath(tree, '/');
    const file = root.files.find((f) => f.filename === 'new.mp4');
    expect(file).toBeDefined();
    expect(file.message_id).toBe(4242);
    expect(file.inode).toBe(4242);
    expect(root.files.some((f) => f.filename === 'old.mp4')).toBe(false);
  });

  it('rejects duplicate sibling file names', () => {
    let tree = createEmptyFileStructure();
    tree = addFile(tree, '/', 'a.mp4', 1);
    tree = addFile(tree, '/', 'b.mp4', 2);
    const after = renameFile(tree, '/', 'a.mp4', 'b.mp4');

    const root = findFolderByPath(after, '/');
    expect(root.files.some((f) => f.filename === 'a.mp4')).toBe(true);
    expect(root.files.filter((f) => f.filename === 'b.mp4')).toHaveLength(1);
  });
});