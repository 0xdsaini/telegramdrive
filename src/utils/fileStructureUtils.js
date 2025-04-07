/**
 * Utility functions for managing file structure in Telegram messages
 */

/**
 * Creates an empty file structure with root directory
 * @returns {Object} Empty file structure
 */
export const createEmptyFileStructure = () => {
  return {
    name: "/",
    subfolders: [],
    files: []
  };
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
    const jsonStartIndex = messageText.indexOf('\n');
    if (jsonStartIndex === -1) {
      return createEmptyFileStructure();
    }
    
    const jsonString = messageText.substring(jsonStartIndex).trim();
    const fileStructure = JSON.parse(jsonString);
    
    // Validate basic structure
    if (!fileStructure.name || !Array.isArray(fileStructure.subfolders) || !Array.isArray(fileStructure.files)) {
      return createEmptyFileStructure();
    }
    
    return fileStructure;
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
    return `METADATA_STORAGE\n${jsonString}`;
  } catch (error) {
    console.error('Error serializing file structure:', error);
    return `METADATA_STORAGE\n${JSON.stringify(createEmptyFileStructure(), null, 2)}`;
  }
};

/**
 * Finds a folder in the file structure by path
 * @param {Object} fileStructure - The file structure object
 * @param {string} path - Path to the folder (e.g., "/Home/Documents")
 * @returns {Object|null} The folder object or null if not found
 */
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
  
  // Create new folder
  parent.subfolders.push({
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
 * @param {string} messageId - Telegram message ID containing the file
 * @returns {Object} Updated file structure
 */
export const addFile = (fileStructure, folderPath, filename, messageId) => {
  const folder = findFolderByPath(fileStructure, folderPath);
  if (!folder) {
    console.error(`Folder not found: ${folderPath}`);
    return fileStructure;
  }
  
  // Check if file already exists
  const existingFileIndex = folder.files.findIndex(f => f.filename === filename);
  if (existingFileIndex !== -1) {
    // Update existing file
    folder.files[existingFileIndex] = {
      inode: `file_${Date.now()}`,
      filename,
      message_id: messageId
    };
  } else {
    // Add new file
    folder.files.push({
      inode: `file_${Date.now()}`,
      filename,
      message_id: messageId
    });
  }
  
  return fileStructure;
};

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