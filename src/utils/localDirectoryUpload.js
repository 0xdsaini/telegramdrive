import { folderUploadDebug, folderUploadDebugError } from './folderUploadDebug';

export const FOLDER_UPLOAD_PICKER_ID = 'telegram-drive-folder-upload-v1';

const BRAVE_FSA_FLAG_URL = 'brave://flags/#file-system-access-api';

export const isBraveBrowserSync = () =>
  typeof navigator !== 'undefined' && /\bBrave\//i.test(navigator.userAgent || '');

/** Shown when webkitdirectory is used and empty folders need another path (e.g. Brave default). */
export const folderUploadWithoutDirectoryPickerHint = () => {
  if (isBraveBrowserSync()) {
    return (
      `On Brave, empty folders are not visible to the file picker unless File System Access is on. `
      + `Drag the folder from Finder onto this page (recommended), or enable “File System Access API” `
      + `at ${BRAVE_FSA_FLAG_URL} and reload.`
    );
  }
  if (typeof navigator !== 'undefined' && /Macintosh|Mac OS X/i.test(navigator.userAgent || '')) {
    return 'Drag the folder from Finder onto this page to include empty folders.';
  }
  return 'Drag the folder onto this page to include empty folders.';
};

const readAllDirectoryEntries = (reader) =>
  new Promise((resolve, reject) => {
    const entries = [];
    const readBatch = () => {
      reader.readEntries(
        (batch) => {
          if (batch.length === 0) {
            resolve(entries);
            return;
          }
          entries.push(...batch);
          readBatch();
        },
        reject,
      );
    };
    readBatch();
  });

const fileEntryToUploadFile = (fileEntry, relativePath) =>
  new Promise((resolve, reject) => {
    fileEntry.file(
      (file) => {
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          configurable: true,
          enumerable: true,
        });
        resolve(file);
      },
      reject,
    );
  });

/**
 * Walk a dropped directory (File and Directory Entries API — works in Brave without FSA flag).
 * @param {FileSystemEntry} entry
 * @param {string} originalRootName
 * @param {string} pathInsideRoot path under the selected root, no leading slash
 */
const walkDroppedEntry = async (entry, originalRootName, pathInsideRoot) => {
  if (entry.isFile) {
    const rel = pathInsideRoot
      ? `${originalRootName}/${pathInsideRoot}/${entry.name}`
      : `${originalRootName}/${entry.name}`;
    const file = await fileEntryToUploadFile(entry, rel.replace(/\/+/g, '/'));
    return { files: [file], emptyDirectoryPaths: [] };
  }

  if (!entry.isDirectory) {
    return { files: [], emptyDirectoryPaths: [] };
  }

  const reader = entry.createReader();
  const children = await readAllDirectoryEntries(reader);

  if (children.length === 0) {
    const emptyDirectoryPaths = pathInsideRoot ? [pathInsideRoot] : [];
    return { files: [], emptyDirectoryPaths };
  }

  const files = [];
  const emptyDirectoryPaths = [];
  for (const child of children) {
    const childPath = pathInsideRoot ? `${pathInsideRoot}/${child.name}` : child.name;
    const nested = await walkDroppedEntry(child, originalRootName, childPath);
    files.push(...nested.files);
    emptyDirectoryPaths.push(...nested.emptyDirectoryPaths);
  }
  return { files, emptyDirectoryPaths };
};

/**
 * Collect a folder tree from Finder / OS drag-and-drop (includes empty directories).
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<{ files: File[], emptyDirectoryPaths: string[], originalRootName: string } | null>}
 */
export const collectDirectoryFromDataTransfer = async (dataTransfer) => {
  if (!dataTransfer?.items?.length) {
    return null;
  }

  const entries = [];
  for (const item of dataTransfer.items) {
    if (item.kind !== 'file' || typeof item.webkitGetAsEntry !== 'function') {
      continue;
    }
    const entry = item.webkitGetAsEntry();
    if (entry) {
      entries.push(entry);
    }
  }

  const rootDir = entries.find((e) => e.isDirectory);
  if (!rootDir) {
    return null;
  }

  if (entries.some((e) => e.isFile)) {
    return null;
  }

  const originalRootName = rootDir.name;
  const { files, emptyDirectoryPaths } = await walkDroppedEntry(rootDir, originalRootName, '');

  const payload = { files, emptyDirectoryPaths, originalRootName };
  folderUploadDebug('picker:drag-collected', {
    originalRootName,
    fileCount: files.length,
    emptyDirectoryPaths,
  });
  return payload;
};

/**
 * Walk a local directory (File System Access API) and collect files plus empty-folder paths.
 * @param {FileSystemDirectoryHandle} directoryHandle
 * @returns {Promise<{
 *   files: File[],
 *   emptyDirectoryPaths: string[],
 *   originalRootName: string,
 * }>}
 */
export const collectLocalDirectoryForUpload = async (directoryHandle) => {
  const originalRootName = directoryHandle.name;
  const files = [];
  const emptyDirectoryPaths = [];

  const walk = async (dirHandle, pathInsideRoot) => {
    const children = [];
    for await (const entry of dirHandle.values()) {
      children.push(entry);
    }

    if (children.length === 0) {
      if (pathInsideRoot) {
        emptyDirectoryPaths.push(pathInsideRoot);
      }
      return;
    }

    for (const entry of children) {
      const childPath = pathInsideRoot ? `${pathInsideRoot}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        await walk(entry, childPath);
      } else {
        const file = await entry.getFile();
        const relativePath = `${originalRootName}/${childPath}`;
        Object.defineProperty(file, 'webkitRelativePath', {
          value: relativePath,
          configurable: true,
          enumerable: true,
        });
        files.push(file);
      }
    }
  };

  await walk(directoryHandle, '');

  const payload = {
    files,
    emptyDirectoryPaths,
    originalRootName,
  };
  folderUploadDebug('picker:walk-done', {
    originalRootName,
    fileCount: files.length,
    emptyDirectoryPaths,
  });
  return payload;
};

/**
 * webkitdirectory only returns files — re-open the same folder with the system picker to list empty dirs.
 * @param {File[]} files
 * @param {{ skipSecondPicker?: boolean }} [options]
 */
export const enrichPayloadWithEmptyDirectories = async (files, options = {}) => {
  const roots = new Set(
    files
      .map((f) => f.webkitRelativePath?.split('/').filter(Boolean)[0])
      .filter(Boolean),
  );
  const originalRootName = roots.size === 1 ? [...roots][0] : undefined;

  const base = {
    files,
    emptyDirectoryPaths: [],
    originalRootName,
  };

  if (!originalRootName || options.skipSecondPicker || !supportsDirectoryPicker()) {
    return base;
  }

  folderUploadDebug('picker:enrich-empty-start', { originalRootName, fileCount: files.length });

  try {
    const handle = await window.showDirectoryPicker({
      id: FOLDER_UPLOAD_PICKER_ID,
      mode: 'read',
    });

    if (handle.name !== originalRootName) {
      folderUploadDebug('picker:enrich-root-mismatch', {
        expected: originalRootName,
        picked: handle.name,
      });
      return base;
    }

    const scanned = await collectLocalDirectoryForUpload(handle);
    const merged = {
      files,
      emptyDirectoryPaths: scanned.emptyDirectoryPaths,
      originalRootName,
    };
    folderUploadDebug('picker:enrich-empty-done', {
      emptyDirectoryPaths: merged.emptyDirectoryPaths,
    });
    return merged;
  } catch (err) {
    if (err?.name === 'AbortError') {
      folderUploadDebug('picker:enrich-empty-aborted', {});
      return base;
    }
    folderUploadDebugError('picker:enrich-empty', err);
    return base;
  }
};

export const supportsDirectoryPicker = () =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';

/**
 * @param {{ fileCount?: number, emptyDirectoryPaths?: string[], originalRootName?: string } | { files?: File[] }} payload
 * @returns {boolean}
 */
export const payloadIncludesEmptyDirectoryScan = (payload) =>
  Array.isArray(payload?.emptyDirectoryPaths) && payload.emptyDirectoryPaths.length > 0;