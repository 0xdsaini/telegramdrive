/**
 * Utility functions for managing file structure in Telegram messages
 */

/** Root folder stable id (compact integer in metadata JSON). */
export const ROOT_FOLDER_ID = 1;

const numericFolderId = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param {Object} node
 * @returns {number}
 */
export const getMaxFolderId = (node) => {
  if (!node) {
    return ROOT_FOLDER_ID;
  }
  let max = numericFolderId(node.id) ?? ROOT_FOLDER_ID;
  for (const sub of node.subfolders || []) {
    max = Math.max(max, getMaxFolderId(sub));
  }
  return max;
};

/**
 * Assign missing folder ids (legacy metadata). Mutates in place.
 * @param {Object} fileStructure
 * @returns {Object}
 */
export const ensureFolderIds = (fileStructure) => {
  if (!fileStructure) {
    return createEmptyFileStructure();
  }
  let next = getMaxFolderId(fileStructure);
  const walk = (node) => {
    if (!numericFolderId(node.id)) {
      node.id = node.name === '/' ? ROOT_FOLDER_ID : (next += 1);
    } else {
      node.id = numericFolderId(node.id);
    }
    for (const sub of node.subfolders || []) {
      walk(sub);
    }
  };
  if (!numericFolderId(fileStructure.id)) {
    fileStructure.id = ROOT_FOLDER_ID;
  }
  walk(fileStructure);
  return fileStructure;
};

/**
 * @param {Object} fileStructure
 * @returns {number}
 */
export const allocateFolderId = (fileStructure) => getMaxFolderId(fileStructure) + 1;

/**
 * Creates an empty file structure with root directory
 * @returns {Object} Empty file structure
 */
export const createEmptyFileStructure = () => {
  return {
    id: ROOT_FOLDER_ID,
    name: "/",
    subfolders: [],
    files: []
  };
};

/**
 * UTC timestamp from metadata JSON (milliseconds since epoch), or null if missing/invalid.
 * @param {Object} fileStructure
 * @returns {number|null}
 */
export const getMetadataTimestampMs = (fileStructure) => {
  const updatedAt = fileStructure?.updatedAt;
  if (!updatedAt || typeof updatedAt !== 'string') {
    return null;
  }
  const parsed = Date.parse(updatedAt);
  return Number.isNaN(parsed) ? null : parsed;
};

/**
 * @param {Object} fileStructure
 * @param {Date} [date]
 * @returns {Object}
 */
export const stampFileStructureUpdatedAt = (fileStructure, date = new Date()) => {
  return {
    ...fileStructure,
    updatedAt: date.toISOString(),
  };
};

/**
 * Deep-merge folder trees. Files: local wins on same filename. Subfolders match by stable `id`
 * when present; display `name` follows `nameWinsFrom` when both sides exist.
 *
 * When `localMembershipWins` is true (default), child folders under a node are taken from `local`
 * only (moves/deletes are preserved; remote-only siblings are not resurrected).
 *
 * @param {Object} remote
 * @param {Object} local
 * @param {{ nameWinsFrom?: 'local' | 'remote', localMembershipWins?: boolean }} [options]
 * @returns {Object}
 */
export const mergeFileStructures = (remote, local, options = {}) => {
  if (!remote) return local;
  if (!local) return remote;

  const nameWinsFrom = options.nameWinsFrom === 'remote' ? 'remote' : 'local';
  const localMembershipWins = options.localMembershipWins !== false;

  const pickFolderName = (remoteFolder, localFolder) => {
    if (!remoteFolder) return localFolder?.name;
    if (!localFolder) return remoteFolder?.name;
    return nameWinsFrom === 'remote' ? remoteFolder.name : localFolder.name;
  };

  const pickFolderId = (remoteFolder, localFolder) => (
    numericFolderId(localFolder?.id)
      ?? numericFolderId(remoteFolder?.id)
      ?? undefined
  );

  const findRemoteChildById = (remoteFolder, id) => (
    (remoteFolder.subfolders || []).find((s) => numericFolderId(s?.id) === id) ?? null
  );

  const findRemoteLegacyChildByName = (remoteFolder, name) => (
    (remoteFolder.subfolders || []).find(
      (s) => s?.name === name && numericFolderId(s?.id) == null,
    ) ?? null
  );

  const mergeFolder = (remoteFolder, localFolder) => {
    if (!remoteFolder) return localFolder;
    if (!localFolder) return remoteFolder;

    const fileMap = new Map();
    for (const file of remoteFolder.files || []) {
      if (file?.filename) fileMap.set(file.filename, { ...file });
    }
    for (const file of localFolder.files || []) {
      if (file?.filename) fileMap.set(file.filename, { ...file });
    }

    const mergedSubfolders = [];

    if (localMembershipWins) {
      for (const sub of localFolder.subfolders || []) {
        const id = numericFolderId(sub?.id);
        if (id != null) {
          mergedSubfolders.push(mergeFolder(findRemoteChildById(remoteFolder, id), sub));
        } else if (sub?.name) {
          mergedSubfolders.push(
            mergeFolder(findRemoteLegacyChildByName(remoteFolder, sub.name), sub),
          );
        }
      }
    } else {
      const byId = new Map();
      const legacyByName = new Map();

      for (const sub of remoteFolder.subfolders || []) {
        const id = numericFolderId(sub?.id);
        if (id != null) {
          const slot = byId.get(id) || { remote: null, local: null };
          slot.remote = sub;
          byId.set(id, slot);
        } else if (sub?.name) {
          const slot = legacyByName.get(sub.name) || { remote: null, local: null };
          slot.remote = sub;
          legacyByName.set(sub.name, slot);
        }
      }
      for (const sub of localFolder.subfolders || []) {
        const id = numericFolderId(sub?.id);
        if (id != null) {
          const slot = byId.get(id) || { remote: null, local: null };
          slot.local = sub;
          byId.set(id, slot);
        } else if (sub?.name) {
          const slot = legacyByName.get(sub.name) || { remote: null, local: null };
          slot.local = sub;
          legacyByName.set(sub.name, slot);
        }
      }

      for (const [, slot] of byId) {
        mergedSubfolders.push(mergeFolder(slot.remote, slot.local));
      }
      for (const [, slot] of legacyByName) {
        mergedSubfolders.push(mergeFolder(slot.remote, slot.local));
      }
    }

    return {
      ...remoteFolder,
      ...localFolder,
      id: pickFolderId(remoteFolder, localFolder) ?? remoteFolder.id ?? localFolder.id,
      name: pickFolderName(remoteFolder, localFolder) ?? remoteFolder.name,
      files: Array.from(fileMap.values()),
      subfolders: mergedSubfolders,
    };
  };

  return mergeFolder(remote, local);
};

/**
 * Legacy metadata without updatedAt: infer from Telegram message edit/send date (unix seconds).
 * @param {Object} fileStructure
 * @param {number} [editDateUnix]
 * @returns {Object}
 */
export const ensureMetadataUpdatedAtFromTelegram = (fileStructure, editDateUnix) => {
  if (getMetadataTimestampMs(fileStructure) != null) {
    return fileStructure;
  }
  if (!editDateUnix) {
    return fileStructure;
  }
  return stampFileStructureUpdatedAt(fileStructure, new Date(editDateUnix * 1000));
};

/**
 * Parses a message text to extract the file structure JSON
 * @param {string} messageText - The text content of the message
 * @returns {Object|null} Parsed file structure or null if invalid
 */
export const parseFileStructure = (messageText) => {
  if (!messageText || typeof messageText !== 'string') {
    return createEmptyFileStructure();
  }

  try {
    // Extract JSON part after METADATA_STORAGE prefix
    const jsonStartIndex = 0;
    if (jsonStartIndex === -1) {
      return createEmptyFileStructure();
    }
    
    const jsonString = messageText.substring(jsonStartIndex).trim();
    console.log("Inside fileStructureUtils, JSON String:", jsonString);
    const fileStructure = JSON.parse(jsonString);
    console.log("Parsed fileStructure(inside fileStructureUtils):", fileStructure);
    
    // Validate basic structure
    if (!fileStructure.name || !Array.isArray(fileStructure.subfolders) || !Array.isArray(fileStructure.files)) {
      return createEmptyFileStructure();
    }

    return ensureFolderIds(fileStructure);
  } catch (error) {
    console.error('Error parsing file structure:', error);
    return createEmptyFileStructure();
  }
};

/**
 * Serializes file structure to a message text
 * @param {Object} fileStructure - The file structure object
 * @returns {string} Formatted message text
 */
export const serializeFileStructure = (fileStructure) => {
  try {
    const jsonString = JSON.stringify(fileStructure, null, 2);
    return `${jsonString}`;
  } catch (error) {
    console.error('Error serializing file structure:', error);
    return `${JSON.stringify(createEmptyFileStructure(), null, 2)}`;
  }
};

/**
 * Finds a folder in the file structure by path
 * @param {Object} fileStructure - The file structure object
 * @param {string} path - Path to the folder (e.g., "/Home/Documents")
 * @returns {Object|null} The folder object or null if not found
 */
/**
 * All Telegram message IDs referenced in metadata, anywhere in the tree.
 * @param {Object} fileStructure
 * @returns {Set<number>}
 */
export const collectTrackedMessageIds = (fileStructure) => {
  const ids = new Set();

  const walk = (node) => {
    if (!node) {
      return;
    }
    for (const file of node.files || []) {
      const messageId = file?.message_id;
      if (messageId != null && messageId !== '') {
        const numericId = Number(messageId);
        if (!Number.isNaN(numericId)) {
          ids.add(numericId);
        }
      }
    }
    for (const subfolder of node.subfolders || []) {
      walk(subfolder);
    }
  };

  walk(fileStructure);
  return ids;
};

export const findFolderByPath = (fileStructure, path) => {
  if (path === '/' || path === '') {
    return fileStructure;
  }
  
  const segments = path.split('/').filter(Boolean);
  let current = fileStructure;
  
  for (const segment of segments) {
    const folder = current.subfolders.find(f => f.name === segment);
    if (!folder) {
      return null;
    }
    current = folder;
  }
  
  return current;
};

/**
 * @param {Object} fileStructure
 * @param {number} folderId
 * @returns {Object|null}
 */
export const findFolderById = (fileStructure, folderId) => {
  const want = numericFolderId(folderId);
  if (want == null || !fileStructure) {
    return null;
  }
  if (numericFolderId(fileStructure.id) === want) {
    return fileStructure;
  }
  for (const sub of fileStructure.subfolders || []) {
    const found = findFolderById(sub, want);
    if (found) {
      return found;
    }
  }
  return null;
};

/**
 * Creates a new folder in the file structure
 * @param {Object} fileStructure - The file structure object
 * @param {string} parentPath - Path to the parent folder
 * @param {string} folderName - Name of the new folder
 * @returns {Object} Updated file structure
 */
export const createFolder = (fileStructure, parentPath, folderName) => {
  const parent = findFolderByPath(fileStructure, parentPath);
  if (!parent) {
    console.error(`Parent folder not found: ${parentPath}`);
    return fileStructure;
  }
  
  // Check if folder already exists
  if (parent.subfolders.some(f => f.name === folderName)) {
    console.error(`Folder already exists: ${folderName}`);
    return fileStructure;
  }
  
  parent.subfolders.push({
    id: allocateFolderId(fileStructure),
    name: folderName,
    subfolders: [],
    files: []
  });
  
  return fileStructure;
};

/**
 * Deletes a folder from the file structure
 * @param {Object} fileStructure - The file structure object
 * @param {string} path - Full path to the folder to delete
 * @returns {Object} Updated file structure
 */
export const deleteFolder = (fileStructure, path) => {
  if (path === '/' || path === '') {
    console.error('Cannot delete root folder');
    return fileStructure;
  }
  
  const segments = path.split('/').filter(Boolean);
  const folderName = segments.pop();
  const parentPath = '/' + segments.join('/');
  
  const parent = findFolderByPath(fileStructure, parentPath);
  if (!parent) {
    console.error(`Parent folder not found: ${parentPath}`);
    return fileStructure;
  }
  
  // Remove folder
  parent.subfolders = parent.subfolders.filter(f => f.name !== folderName);
  
  return fileStructure;
};

/**
 * Renames a folder in place (same parent, new display name).
 * @param {Object} fileStructure - The file structure object
 * @param {string} path - Full path to the folder to rename
 * @param {string} newFolderName - New folder name
 * @returns {Object} Updated file structure
 */
export const renameFolder = (fileStructure, path, newFolderName) => {
  if (path === '/' || path === '') {
    console.error('Cannot rename root folder');
    return fileStructure;
  }

  const trimmed = typeof newFolderName === 'string' ? newFolderName.trim() : '';
  if (!trimmed || trimmed.includes('/')) {
    console.error('Invalid folder name for rename');
    return fileStructure;
  }

  const segments = path.split('/').filter(Boolean);
  const oldName = segments.pop();
  const parentPath = segments.length ? `/${segments.join('/')}` : '/';

  const parent = findFolderByPath(fileStructure, parentPath);
  if (!parent) {
    console.error(`Parent folder not found: ${parentPath}`);
    return fileStructure;
  }

  const folder = parent.subfolders.find((f) => f.name === oldName);
  if (!folder) {
    console.error(`Folder not found: ${oldName}`);
    return fileStructure;
  }

  if (trimmed === oldName) {
    return fileStructure;
  }

  if (parent.subfolders.some((f) => f.name === trimmed)) {
    console.error(`Folder already exists: ${trimmed}`);
    return fileStructure;
  }

  folder.name = trimmed;
  return fileStructure;
};

/**
 * Moves a folder to a new location
 * @param {Object} fileStructure - The file structure object
 * @param {string} sourcePath - Path to the folder to move
 * @param {string} destPath - Path to the destination folder
 * @returns {Object} Updated file structure
 */
export const moveFolder = (fileStructure, sourcePath, destPath) => {
  if (sourcePath === '/' || sourcePath === '') {
    console.error('Cannot move root folder');
    return fileStructure;
  }
  
  // Check if destination is a subfolder of source
  if (destPath.startsWith(sourcePath + '/')) {
    console.error('Cannot move a folder to its own subfolder');
    return fileStructure;
  }
  
  const segments = sourcePath.split('/').filter(Boolean);
  const folderName = segments.pop();
  const sourceParentPath = '/' + segments.join('/');
  
  // Check if we're trying to move to the same location
  // We need to compare the full paths to prevent moving to exactly the same path
  // But allow moving to parent directories
  if (sourcePath === destPath) {
    console.error('Folder is already in this location');
    return fileStructure;
  }
  
  const sourceParent = findFolderByPath(fileStructure, sourceParentPath);
  if (!sourceParent) {
    console.error(`Source parent folder not found: ${sourceParentPath}`);
    return fileStructure;
  }
  
  const destFolder = findFolderByPath(fileStructure, destPath);
  if (!destFolder) {
    console.error(`Destination folder not found: ${destPath}`);
    return fileStructure;
  }
  
  // Check if folder with same name already exists in destination
  // When moving to parent directory, we need to exclude the case where the folder
  // being moved is already a child of the destination folder
  if (destPath !== sourceParentPath && destFolder.subfolders.some(f => f.name === folderName)) {
    console.error(`Folder with name ${folderName} already exists in destination`);
    return fileStructure;
  }
  
  // Find the folder to move
  const folderToMove = sourceParent.subfolders.find(f => f.name === folderName);
  if (!folderToMove) {
    console.error(`Folder not found: ${folderName}`);
    return fileStructure;
  }
  
  // Remove from source
  sourceParent.subfolders = sourceParent.subfolders.filter(f => f.name !== folderName);
  
  // Add to destination
  destFolder.subfolders.push(folderToMove);
  
  return fileStructure;
};

/**
 * Adds a file to the file structure
 * @param {Object} fileStructure - The file structure object
 * @param {string} folderPath - Path to the folder where to add the file
 * @param {string} filename - Name of the file
 * @param {number|string} messageId - Telegram message ID containing the file (unique per chat)
 * @returns {Object} Updated file structure
 */
export const addFile = (fileStructure, folderPath, filename, messageId) => {
  const folder = findFolderByPath(fileStructure, folderPath);
  if (!folder) {
    console.error(`Folder not found: ${folderPath}`);
    return fileStructure;
  }
  return addFileToFolder(fileStructure, folder, filename, messageId);
};

/**
 * Add a file by stable folder id (survives renames during in-flight uploads).
 */
export const addFileByFolderId = (fileStructure, folderId, filename, messageId) => {
  const folder = findFolderById(fileStructure, folderId);
  if (!folder) {
    console.error(`Folder not found for id: ${folderId}`);
    return fileStructure;
  }
  return addFileToFolder(fileStructure, folder, filename, messageId);
};

function addFileToFolder(fileStructure, folder, filename, messageId) {
  const numericMessageId = Number(messageId);
  if (!Number.isFinite(numericMessageId)) {
    console.error(`Invalid message_id for addFile: ${messageId}`);
    return fileStructure;
  }

  const entry = {
    inode: numericMessageId,
    filename,
    message_id: numericMessageId,
  };

  const existingFileIndex = folder.files.findIndex((f) => f.filename === filename);
  if (existingFileIndex !== -1) {
    folder.files[existingFileIndex] = entry;
  } else {
    folder.files.push(entry);
  }

  return fileStructure;
}

/**
 * Deletes a file from the file structure
 * @param {Object} fileStructure - The file structure object
 * @param {string} folderPath - Path to the folder containing the file
 * @param {string} filename - Name of the file to delete
 * @returns {Object} Updated file structure
 */
export const deleteFile = (fileStructure, folderPath, filename) => {
  const folder = findFolderByPath(fileStructure, folderPath);
  if (!folder) {
    console.error(`Folder not found: ${folderPath}`);
    return fileStructure;
  }
  
  // Remove file
  folder.files = folder.files.filter(f => f.filename !== filename);
  
  return fileStructure;
};

/**
 * Moves a file to a new location
 * @param {Object} fileStructure - The file structure object
 * @param {string} sourcePath - Path to the folder containing the file
 * @param {string} filename - Name of the file to move
 * @param {string} destPath - Path to the destination folder
 * @returns {Object} Updated file structure
 */
export const moveFile = (fileStructure, sourcePath, filename, destPath) => {
  const sourceFolder = findFolderByPath(fileStructure, sourcePath);
  if (!sourceFolder) {
    console.error(`Source folder not found: ${sourcePath}`);
    return fileStructure;
  }
  
  // Check if we're trying to move to the same location
  // We only need to prevent moving to exactly the same path
  // This allows moving to parent directories
  if (sourcePath === destPath) {
    console.error('File is already in this location');
    return fileStructure;
  }
  
  const destFolder = findFolderByPath(fileStructure, destPath);
  if (!destFolder) {
    console.error(`Destination folder not found: ${destPath}`);
    return fileStructure;
  }
  
  // Find the file to move
  const fileToMove = sourceFolder.files.find(f => f.filename === filename);
  if (!fileToMove) {
    console.error(`File not found: ${filename}`);
    return fileStructure;
  }
  
  // Check if file with same name already exists in destination
  const existingFileIndex = destFolder.files.findIndex(f => f.filename === filename);
  if (existingFileIndex !== -1) {
    // Replace existing file
    destFolder.files[existingFileIndex] = fileToMove;
  } else {
    // Add to destination
    destFolder.files.push(fileToMove);
  }
  
  // Remove from source
  sourceFolder.files = sourceFolder.files.filter(f => f.filename !== filename);
  
  return fileStructure;
};