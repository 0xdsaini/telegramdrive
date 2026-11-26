import {
  ROOT_FOLDER_ID,
  addFileByFolderId,
  createEmptyFileStructure,
  createFolder,
  ensureFolderIds,
  findFolderById,
  findFolderByPath,
  mergeFileStructures,
  renameFolder,
} from './fileStructureUtils';

describe('folder stable ids', () => {
  it('assigns root id and sequential ids on createFolder', () => {
    let tree = createEmptyFileStructure();
    expect(tree.id).toBe(ROOT_FOLDER_ID);
    tree = createFolder(tree, '/', 'Show');
    const show = findFolderByPath(tree, '/Show');
    expect(show.id).toBe(2);
  });

  it('backfills legacy metadata without ids', () => {
    const legacy = {
      name: '/',
      subfolders: [{ name: 'legacy', subfolders: [], files: [] }],
      files: [],
    };
    const tree = ensureFolderIds(legacy);
    expect(tree.id).toBe(ROOT_FOLDER_ID);
    expect(tree.subfolders[0].id).toBe(2);
  });

  it('addFileByFolderId finds folder after rename', () => {
    let tree = createEmptyFileStructure();
    tree = createFolder(tree, '/', 'old');
    const folderId = findFolderByPath(tree, '/old').id;
    tree = renameFolder(tree, '/old', 'new');
    expect(findFolderByPath(tree, '/old')).toBeNull();

    tree = addFileByFolderId(tree, folderId, 'clip.mkv', 1001);
    const folder = findFolderById(tree, folderId);
    expect(folder.name).toBe('new');
    expect(folder.files).toHaveLength(1);
    expect(folder.files[0].message_id).toBe(1001);
  });
});

describe('mergeFileStructures with folder ids', () => {
  it('keeps remote name but merges files on same folder id', () => {
    let remote = createEmptyFileStructure();
    remote = createFolder(remote, '/', 'Renamed');
    const folderId = findFolderByPath(remote, '/Renamed').id;

    let local = createEmptyFileStructure();
    local = createFolder(local, '/', 'OldName');
    const localFolder = findFolderByPath(local, '/OldName');
    localFolder.id = folderId;
    localFolder.files.push({ filename: 'a.mkv', message_id: 1, inode: 1 });

    const merged = mergeFileStructures(remote, local, { nameWinsFrom: 'remote' });
    const folder = findFolderById(merged, folderId);
    expect(folder.name).toBe('Renamed');
    expect(folder.files.some((f) => f.filename === 'a.mkv')).toBe(true);
    expect(findFolderByPath(merged, '/OldName')).toBeNull();
  });
});