import {
  createEmptyFileStructure,
  createFolder,
  findFolderByPath,
} from './fileStructureUtils';
import {
  planFolderUpload,
  resolveUniqueChildFolderName,
  ensureFolderSegmentChains,
} from './folderUpload';
import { TELEGRAM_MAX_FILE_BYTES } from './telegramDocumentUpload';

const makeFile = (name, relativePath, size = 100) => {
  const file = new File(['x'], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', { value: relativePath, enumerable: true });
  Object.defineProperty(file, 'size', { value: size, enumerable: true });
  return file;
};

describe('resolveUniqueChildFolderName', () => {
  it('returns the desired name when free', () => {
    const tree = createEmptyFileStructure();
    expect(resolveUniqueChildFolderName(tree, 'Photos')).toBe('Photos');
  });

  it('suffixes with 2, 3, … when taken', () => {
    let tree = createEmptyFileStructure();
    tree = createFolder(tree, '/', 'Photos');
    expect(resolveUniqueChildFolderName(tree, 'Photos')).toBe('Photos 2');
    tree = createFolder(tree, '/', 'Photos 2');
    expect(resolveUniqueChildFolderName(tree, 'Photos')).toBe('Photos 3');
  });
});

describe('planFolderUpload', () => {
  it('maps paths under a uniquely named root folder', () => {
    let tree = createEmptyFileStructure();
    tree = createFolder(tree, '/', 'Project');

    const files = [
      makeFile('a.txt', 'Bundle/a.txt'),
      makeFile('b.txt', 'Bundle/sub/b.txt'),
    ];

    const plan = planFolderUpload(tree, '/', files);
    expect(plan.ok).toBe(true);
    expect(plan.resolvedRootName).toBe('Bundle');
    expect(plan.entries).toHaveLength(2);
    expect(plan.entries[0].targetFolderPath).toBe('/Bundle');
    expect(plan.entries[1].targetFolderPath).toBe('/Bundle/sub');
    expect(plan.entries[0].targetFolderId).toBe(
      findFolderByPath(plan.structureWithFolders, '/Bundle').id,
    );
    expect(findFolderByPath(plan.structureWithFolders, '/Bundle/sub')).not.toBeNull();
  });

  it('renames colliding root folder to "Name 2"', () => {
    let tree = createEmptyFileStructure();
    tree = createFolder(tree, '/', 'Bundle');

    const files = [makeFile('a.txt', 'Bundle/a.txt')];
    const plan = planFolderUpload(tree, '/', files);

    expect(plan.ok).toBe(true);
    expect(plan.resolvedRootName).toBe('Bundle 2');
    expect(plan.entries[0].targetFolderPath).toBe('/Bundle 2');
  });

  it('aborts when any file exceeds 2 GB', () => {
    const tree = createEmptyFileStructure();
    const huge = makeFile('big.bin', 'Dir/big.bin', TELEGRAM_MAX_FILE_BYTES + 1);
    const small = makeFile('small.txt', 'Dir/small.txt');

    const plan = planFolderUpload(tree, '/', [small, huge]);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toBe('oversized');
  });
});

describe('ensureFolderSegmentChains', () => {
  it('reuses existing nested folders when names match', () => {
    let tree = createEmptyFileStructure();
    tree = createFolder(tree, '/', 'root');
    tree = createFolder(tree, '/root', 'child');

    tree = ensureFolderSegmentChains(tree, '/', [['root', 'child', 'leaf']]);
    expect(findFolderByPath(tree, '/root/child/leaf')).not.toBeNull();
    expect(findFolderByPath(tree, '/root').subfolders.filter((f) => f.name === 'child')).toHaveLength(1);
  });
});