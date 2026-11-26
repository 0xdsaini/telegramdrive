import {
  createEmptyFileStructure,
  createFolder,
  findFolderByPath,
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