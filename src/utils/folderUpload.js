import {
  createFolder,
  findFolderById,
  findFolderByPath,
} from './fileStructureUtils';
import { findOversizedUploadFiles } from './telegramDocumentUpload';

/**
 * Pick a sibling folder name that does not collide under parent.
 * @param {Object|null} parentFolder
 * @param {string} desiredName
 * @returns {string}
 */
export const resolveUniqueChildFolderName = (parentFolder, desiredName) => {
  if (!parentFolder) {
    return desiredName;
  }
  const taken = (name) => parentFolder.subfolders.some((f) => f.name === name);
  if (!taken(desiredName)) {
    return desiredName;
  }
  let n = 2;
  while (taken(`${desiredName} ${n}`)) {
    n += 1;
  }
  return `${desiredName} ${n}`;
};

/**
 * @param {string} basePath
 * @param {string[]} folderSegments
 * @returns {string}
 */
export const joinFolderPath = (basePath, folderSegments) => {
  let path = basePath;
  for (const seg of folderSegments) {
    path = path === '/' ? `/${seg}` : `${path}/${seg}`;
  }
  return path;
};

/**
 * Create missing folders along segment chains. Uses existing siblings when names already exist.
 * @param {Object} fileStructure
 * @param {string} basePath
 * @param {string[][]} segmentChains Unique lists of folder names (each path from base)
 * @returns {Object} Updated file structure
 */
export const ensureFolderSegmentChains = (fileStructure, basePath, segmentChains) => {
  const sorted = [...segmentChains].sort((a, b) => a.length - b.length);
  let structure = fileStructure;

  for (const segments of sorted) {
    let path = basePath;
    for (const seg of segments) {
      const parent = findFolderByPath(structure, path);
      if (!parent) {
        console.error(`ensureFolderSegmentChains: parent not found at ${path}`);
        break;
      }
      const existing = parent.subfolders.find((f) => f.name === seg);
      if (existing) {
        path = joinFolderPath(path, [seg]);
        continue;
      }
      structure = createFolder(structure, path, seg);
      path = joinFolderPath(path, [seg]);
    }
  }

  return structure;
};

const chainKey = (segments) => segments.join('\0');

/**
 * Plan a folder upload rooted at currentPath.
 * @param {Object} fileStructure
 * @param {string} currentPath
 * @param {File[]} files - from <input webkitdirectory>
 * @returns {{
 *   ok: true,
 *   entries: { file: File, filename: string, targetFolderPath: string, targetFolderId: number }[],
 *   resolvedRootName: string,
 *   originalRootName: string,
 *   structureWithFolders: Object,
 * } | { ok: false, reason: string, message: string, oversized?: { displayName: string, size: number }[] }}
 */
export const planFolderUpload = (fileStructure, currentPath, files) => {
  const oversized = findOversizedUploadFiles(files);
  if (oversized.length > 0) {
    return {
      ok: false,
      reason: 'oversized',
      message: 'One or more files exceed the 2 GB Telegram limit.',
      oversized: oversized.map(({ displayName, size }) => ({ displayName, size })),
    };
  }

  const withPaths = [];
  for (const file of files) {
    const rel = file.webkitRelativePath;
    if (rel) {
      withPaths.push({ file, relativePath: rel });
    }
  }

  if (withPaths.length === 0) {
    return {
      ok: false,
      reason: 'no_files',
      message: 'No files found in the selected folder.',
    };
  }

  const rootNames = new Set(
    withPaths.map(({ relativePath }) => relativePath.split('/').filter(Boolean)[0]),
  );
  if (rootNames.size !== 1) {
    return {
      ok: false,
      reason: 'multiple_roots',
      message: 'Unexpected folder layout; please select a single folder to upload.',
    };
  }

  const originalRootName = [...rootNames][0];
  const parent = findFolderByPath(fileStructure, currentPath);
  if (!parent) {
    return {
      ok: false,
      reason: 'invalid_path',
      message: `Current folder not found: ${currentPath}`,
    };
  }

  const resolvedRootName = resolveUniqueChildFolderName(parent, originalRootName);

  const entries = [];
  const chains = new Map();

  for (const { file, relativePath } of withPaths) {
    const segments = relativePath.split('/').filter(Boolean);
    segments[0] = resolvedRootName;
    const filename = segments[segments.length - 1];
    const folderSegments = segments.slice(0, -1);
    const targetFolderPath = joinFolderPath(currentPath, folderSegments);
    entries.push({ file, filename, targetFolderPath });
    if (folderSegments.length > 0) {
      chains.set(chainKey(folderSegments), folderSegments);
    }
  }

  const structureWithFolders = ensureFolderSegmentChains(
    fileStructure,
    currentPath,
    [...chains.values()],
  );

  const entriesWithIds = entries.map((entry) => {
    const folder = findFolderByPath(structureWithFolders, entry.targetFolderPath);
    return {
      ...entry,
      targetFolderId: folder?.id,
    };
  });

  return {
    ok: true,
    entries: entriesWithIds,
    resolvedRootName,
    originalRootName,
    structureWithFolders,
  };
};

/**
 * @param {Object} fileStructure
 * @param {{ filename: string, targetFolderPath: string }[]} entries
 * @returns {{ filename: string, targetFolderPath: string }[]}
 */
export const findFolderUploadFileCollisions = (fileStructure, entries) => {
  const collisions = [];
  for (const entry of entries) {
    const folder =
      entry.targetFolderId != null
        ? findFolderById(fileStructure, entry.targetFolderId)
        : findFolderByPath(fileStructure, entry.targetFolderPath);
    if (!folder) {
      continue;
    }
    if (folder.files.some((f) => f.filename === entry.filename)) {
      collisions.push({
        filename: entry.filename,
        targetFolderPath: entry.targetFolderPath,
      });
    }
  }
  return collisions;
};