import React, { useState, useRef, useEffect, useContext, useCallback } from 'react';
import './FileExplorer.css';
import { FaFile, FaFileImage, FaFileAlt, FaFileCode, FaFolder, FaTrash, FaArrowUp, FaPlus, FaUpload, FaHome, FaCheck } from 'react-icons/fa';
import FileGridItem from './FileGridItem';
import VideoPlayerModal from '../VideoPlayer/VideoPlayerModal';
import VideoPosterTile from './VideoPosterTile';
import { resolveTelegramFile } from '../../utils/telegramFileResolver';
import { getStreamUrl } from '../../utils/streamUrl';
import { isStreamableMediaFileName, isVideoFileName, mimeTypeFromFileName } from '../../utils/mimeTypes';
import { generateVideoPosterJpeg } from '../../utils/generateVideoPosterJpeg';
import { setCachedPoster } from '../../utils/thumbnailCache';
import { streamDebug, streamDebugError } from '../../utils/streamDebug';
import {
  prepareForStreaming,
  registerPlaybackFileId,
  setPlaybackModalOpen,
  unregisterPlaybackFileId,
} from '../../utils/streamBridge';
import { requestTdlibFilePart } from '../../utils/tdlibFilePartReader';
import {
  downloadTelegramFileAsBlob,
  triggerBrowserFileDownload,
} from '../../utils/downloadTelegramFile';
import { createEmptyFileStructure, findFolderByPath, createFolder, deleteFolder, moveFolder, addFile, deleteFile, moveFile } from '../../utils/fileStructureUtils';
import { TelegramContext } from '../../context/TelegramContext';
import UntrackedFilesPanel, { useUntrackedFiles } from './UntrackedFilesPanel';
import UntrackedFilesToggle from './UntrackedFilesToggle';

// (function() {
//   const originalLog = console.log;
//   let logData = [];

//   console.log = function(...args) {
//     const formattedArgs = args.map(arg => {
//       if (typeof arg === 'object') {
//         return JSON.stringify(arg, null, 2); // Properly format objects
//       }
//       return arg;
//     });

//     const logEntry = `[${new Date().toISOString()}] ${formattedArgs.join(' ')}`;
//     logData.push(logEntry);
//     originalLog.apply(console, args);
//   };

//   window.saveLogs = function() {
//     const blob = new Blob([logData.join('\n')], { type: 'text/plain' });
//     const a = document.createElement('a');
//     a.href = URL.createObjectURL(blob);
//     a.download = 'console_logs.txt';
//     a.click();
//   };
// })();


// Helper function to determine the appropriate icon based on file extension
const getFileIcon = (filename) => {
  const extension = filename.split('.').pop().toLowerCase();
  
  // Image files
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'webp'].includes(extension)) {
    return <FaFileImage />;
  }
  
  // Code files
  if (['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'py', 'java', 'c', 'cpp', 'php', 'rb', 'go'].includes(extension)) {
    return <FaFileCode />;
  }
  
  // Text/Document files
  if (['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'json'].includes(extension)) {
    return <FaFileAlt />;
  }
  
  // Default file icon for unknown types
  return <FaFile />;
};

const FileExplorer = () => {
  const [currentPath, setCurrentPath] = useState('/');
  const [currentFolder, setCurrentFolder] = useState(null);
  const fileInputRef = useRef(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [streamPlayer, setStreamPlayer] = useState({ open: false, url: '', title: '', fileId: null });
  
  // Access the Telegram context
  const { 
    fileStructure, 
    updateFileStructure, 
    isFileStructureLoaded, 
    isConnected,
    telegramClient,
    selectedChatId,
    clearDownloadedFiles,
    isDryModeEnabled
  } = useContext(TelegramContext);

  const preparePlayback = useCallback(
    (opts) => prepareForStreaming(telegramClient, opts),
    [telegramClient]
  );

  const untrackedFilesState = useUntrackedFiles({
    currentPath,
    onSuccess: setSuccess,
    onError: setError,
  });

  useEffect(() => {
    setPlaybackModalOpen(streamPlayer.open);
    if (!streamPlayer.open && streamPlayer.fileId != null) {
      unregisterPlaybackFileId(streamPlayer.fileId);
    }
  }, [streamPlayer.open, streamPlayer.fileId]);

  useEffect(() => {
    if (!isConnected || !telegramClient) {
      return;
    }
    prepareForStreaming(telegramClient, {
      allowReload: false,
      timeoutMs: 12_000,
    }).catch((err) => {
      streamDebug('play', 'background prepareForStreaming', { err: err?.message });
    });
  }, [isConnected, telegramClient]);
  
  // Update current folder when file structure or path changes
  useEffect(() => {
    if (fileStructure) {
      updateCurrentFolder();
    }
  }, [fileStructure, currentPath]);
  
  // Update current folder based on current path
  const updateCurrentFolder = () => {
    if (currentPath === '/') {
      setCurrentFolder(fileStructure);
      return;
    }
    
    const folder = findFolderByPath(fileStructure, currentPath);
    if (folder) {
      setCurrentFolder(folder);
    } else {
      // If folder not found, reset to root
      setCurrentPath('/');
      setCurrentFolder(fileStructure);
    }
  };

  const handleCreateFolder = async (folderName) => {
    try {
      setError(null);
      setSuccess(null);
      
      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }
      
      if (!selectedChatId) {
        setError('No chat group selected. Please select a chat group first.');
        return;
      }
      
      // Validate folder name
      if (!folderName || folderName.includes('/')) {
        setError('Invalid folder name. Folder name cannot be empty or contain "/"');
        return;
      }
      
      setSuccess("Creating folder...Updating Telegram Servers...");
      // Create folder in the file structure
      const updatedStructure = createFolder(fileStructure, currentPath, folderName);
      
      // Update the file structure in Telegram
      const success = await window.updateTelegramFileStructure(updatedStructure);
      
      if (success) {
        setSuccess(`Folder "${folderName}" created successfully`);
      } else {
        setError('Failed to create folder');
      }
    } catch (error) {
      console.error('Failed to create folder:', error);
      setError('Failed to create folder: ' + error.message);
    }
  };

  const handleNewFolderClick = () => {
    const folderName = prompt('Enter folder name:');
    if (folderName) {
      handleCreateFolder(folderName);
    }
  };

  // Helper function to recursively collect all files in a folder and its subfolders
  const collectFilesInFolder = (folder, path = '') => {
    let files = [];
    
    // Add files in current folder
    if (folder.files && Array.isArray(folder.files)) {
      files = folder.files.map(file => ({
        ...file,
        path: path
      }));
    }
    
    // Recursively add files from subfolders
    if (folder.subfolders && Array.isArray(folder.subfolders)) {
      for (const subfolder of folder.subfolders) {
        const subfolderPath = path === '/' ? `/${subfolder.name}` : `${path}/${subfolder.name}`;
        const subfolderFiles = collectFilesInFolder(subfolder, subfolderPath);
        files = [...files, ...subfolderFiles];
      }
    }
    
    return files;
  };

  const handleDeleteFolder = async (folderName, e) => {
    e.stopPropagation(); // Prevent folder navigation when clicking delete
    
    if (!window.confirm(`Are you sure you want to delete the folder "${folderName}"?`)) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      
      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }
      
      const folderPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
      
      // Find the folder to delete
      const folderToDelete = findFolderByPath(fileStructure, folderPath);
      if (!folderToDelete) {
        setError(`Folder not found: ${folderPath}`);
        return;
      }

      console.log("dry mode: ", isDryModeEnabled);
      let DRY_MODE;
      // if there is no dry mode, assume it to be true by default. Safety first!
      if (isDryModeEnabled === true || isDryModeEnabled === false) {
        DRY_MODE = isDryModeEnabled;
      } else {
        // if it is not true or false, assume it is a string and try to parse it
        DRY_MODE = true;
      }


      // Use the isDryModeEnabled state from TelegramContext
      // Collect all files in the folder and its subfolders
      const filesToDelete = collectFilesInFolder(folderToDelete, folderPath);
      console.log(`Found ${filesToDelete.length} files to delete in folder ${folderPath}`);
      
      // Delete all files from Telegram
      for (const file of filesToDelete) {
        if (file.message_id) {
          if (!DRY_MODE) {
            try {
              await telegramClient.send({
                '@type': 'deleteMessages',
                'chat_id': selectedChatId,
                'message_ids': [file.message_id],
                'revoke': true
              });
              console.log(`Deleted message with ID: ${file.message_id} for file: ${file.filename}`);
            } catch (deleteError) {
              console.error(`Error deleting message for file ${file.filename}: ${deleteError.message}`);
              // Continue with other files even if one deletion fails
            }
          } else {
              console.log(`Dry Mode enabled: Not deleting file : ${file.message_id} for file: ${file.filename}`);
          }
        }
      }
      
      // Delete folder from the file structure
      const updatedStructure = deleteFolder(fileStructure, folderPath);
      
      // Update the file structure in Telegram
      const success = await window.updateTelegramFileStructure(updatedStructure);
      
      if (success) {
        setSuccess(`Folder "${folderName}" and all its contents deleted successfully`);
      } else {
        setError('Failed to delete folder');
      }
    } catch (error) {
      console.error('Failed to delete folder:', error);
      setError('Failed to delete folder: ' + error.message);
    }
  };

  // This function is no longer needed as we're using the TelegramContext
  // to manage the file structure

  const handlePathClick = (index) => {
    if (index === 0) {
      setCurrentPath('/');
      setCurrentFolder(fileStructure);
      return;
    }

    const pathSegments = currentPath.split('/').filter(Boolean);
    const newPathSegments = pathSegments.slice(0, index);
    const newPath = '/' + newPathSegments.join('/');
    
    setCurrentPath(newPath);
    
    let current = fileStructure;
    for (const segment of newPathSegments) {
      const nextFolder = current.subfolders.find(folder => folder.name === segment);
      if (!nextFolder) {
        console.error(`Folder ${segment} not found`);
        return;
      }
      current = nextFolder;
    }
    
    setCurrentFolder(current);
  };

  const handleFolderClick = (folderName) => {
    const newPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
    setCurrentPath(newPath);
    
    const targetFolder = currentFolder.subfolders.find(folder => folder.name === folderName);
    if (targetFolder) {
      setCurrentFolder(targetFolder);
    }
  };

  // Drag and drop event handlers are defined below

  // First implementation of handleFolderDrop

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
    
    if (e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      setSuccess(`Preparing to upload ${droppedFiles.length} file(s)...`);
      handleFiles(droppedFiles);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('drag-over');
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
  };

  const handleDragEnd = (e) => {
    e.preventDefault();
    // Remove drag-over and drag-invalid classes from all elements
    document.querySelectorAll('.drag-over').forEach(element => {
      element.classList.remove('drag-over');
    });
    document.querySelectorAll('.drag-invalid').forEach(element => {
      element.classList.remove('drag-invalid');
    });
  };
  
  // This is the most complete implementation of handleFolderDragOver
  const handleFolderDragOver = (e, folderName) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event bubbling to parent containers
    
    // Get the drag data to check if it's a valid drop target
    const dragData = e.dataTransfer.getData('text/plain');
    if (dragData.startsWith('folder:')) {
      const sourcePath = dragData.replace('folder:', '');
      const destPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
      
      // Check if it's an invalid drop target (itself or its child)
      if (sourcePath === destPath || destPath.startsWith(sourcePath + '/')) {
        e.currentTarget.classList.add('drag-invalid');
        e.currentTarget.classList.remove('drag-over');
      } else {
        e.currentTarget.classList.add('drag-over');
        e.currentTarget.classList.remove('drag-invalid');
      }
    } else if (dragData.startsWith('file:')) {
      // Always valid for files
      e.currentTarget.classList.add('drag-over');
      e.currentTarget.classList.remove('drag-invalid');
    } else {
      e.currentTarget.classList.add('drag-over');
    }
  };
  
  // Handle leaving a folder during drag
  const handleFolderDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event bubbling
    e.currentTarget.classList.remove('drag-over');
    e.currentTarget.classList.remove('drag-invalid');
  };
  
  // Handle dropping on a specific folder
  const handleFolderDrop = async (e, folderName) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event bubbling to parent containers
    e.currentTarget.classList.remove('drag-over');
    
    if (!isConnected || !telegramClient) {
      setError('Not connected to Telegram. Please authenticate first.');
      return;
    }
    
    // Handle file drops from the file system
    if (e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      handleFiles(droppedFiles);
      return;
    }

    // Get drag data
    const dragData = e.dataTransfer.getData('text/plain');
    console.log("dragData: ", dragData);
    console.log("folderName: ", folderName);
    
    // NOTICE: ERRORNEOUS ZONE: This is problematic. we're relying on folderName(the destination folder) being undefined as a definitive way to determine if the drop is on the parent folder area. We should be using a better method, like passing the destination folder's path to this function or something more robust like that.
    // Note: this was working fine in commit, 29a52edc5ab6db0fa0c260608e221c112d452c1a. Maybe you'd like to study this part from there.

    // Check if this is a drop on the parent folder area (when folderName is undefined and we're not at root)
    const isParentFolderDrop = !folderName && currentPath !== '/';
    
    // Handle folder drops
    if (dragData.startsWith('folder:')) {
      const sourcePath = dragData.replace('folder:', '');
      
      let destPath;
      if (isParentFolderDrop) {
        // If dropping on parent folder area, set destination to parent directory
        const pathSegments = currentPath.split('/').filter(Boolean);
        pathSegments.pop(); // Remove the last segment to get the parent path
        destPath = pathSegments.length === 0 ? '/' : '/' + pathSegments.join('/');
      } else {
        // Normal folder drop - either on a specific folder or in the current directory
        destPath = folderName ? 
          (currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`) : 
          currentPath;
      }
      
      // Normalize paths for comparison
      const normalizedSourcePath = sourcePath.startsWith('/') ? sourcePath : `/${sourcePath}`;
      const normalizedDestPath = destPath.startsWith('/') ? destPath : `/${destPath}`;
      
      // Check if source and destination are the same folder
      if (normalizedSourcePath === normalizedDestPath) {
        setError('Cannot move a folder into itself');
        return;
      }
      
      // Check if destination is a subfolder of source
      if (normalizedDestPath.startsWith(normalizedSourcePath + '/')) {
        setError('Cannot move a folder into its subfolder');
        return;
      }
      
      console.log('Source Path:', sourcePath);
      console.log('Destination Path:', destPath);
    
      try {
        setError(null);
        setSuccess(null);
        
        // Move folder in the file structure
        const updatedStructure = moveFolder(fileStructure, sourcePath, destPath);
        
        // Update the file structure in Telegram
        const success = await window.updateTelegramFileStructure(updatedStructure);
        
        if (success) {
          setSuccess(`Folder moved successfully to ${destPath}`);
        } else {
          setError('Failed to move folder');
        }
      } catch (error) {
        console.error('Failed to move folder:', error);
        setError('Failed to move folder: ' + error.message);
      }
    }
    // Handle file drops
    else if (dragData.startsWith('file:')) {
      const sourceFilePath = dragData.replace('file:', '');
      const fileName = sourceFilePath.split('/').pop();
      
      let destPath;
      if (isParentFolderDrop) {
        // If dropping on parent folder area, set destination to parent directory
        const pathSegments = currentPath.split('/').filter(Boolean);
        pathSegments.pop(); // Remove the last segment to get the parent path
        destPath = pathSegments.length === 0 ? '/' : '/' + pathSegments.join('/');
      } else {
        // Normal file drop - either on a specific folder or in the current directory
        destPath = folderName ? 
          (currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`) : 
          currentPath;
      }
      
      // Get the parent path of the source file
      const sourcePathSegments = sourceFilePath.split('/').filter(Boolean);
      const sourceParentPathSegments = sourcePathSegments.slice(0, -1);
      const sourceParentPath = sourceParentPathSegments.length === 0 ? '/' : '/' + sourceParentPathSegments.join('/');
      
      // Check if we're dropping to the same folder (current location)
      const sourceFullPath = sourceFilePath;
      const destFullPath = destPath === '/' ? `/${fileName}` : `${destPath}/${fileName}`;
      
      if (sourceFullPath === destFullPath) {
        setSuccess('File is already in this location');
        return;
      }
      
      console.log('Source File Path:', sourceFilePath);
      console.log('Destination Path:', destPath);
    
      try {
        setError(null);
        setSuccess(null);
        
        // Move file in the file structure
        const updatedStructure = moveFile(fileStructure, sourceParentPath, fileName, destPath);
        
        // Update the file structure in Telegram
        const success = await window.updateTelegramFileStructure(updatedStructure);
        
        if (success) {
          setSuccess(`File "${fileName}" moved successfully to ${destPath}`);
        } else {
          setError('Failed to move file');
        }
      } catch (error) {
        console.error('Failed to move file:', error);
        setError('Failed to move file: ' + error.message);
      }
    }
  };

  const handleFiles = (newFiles) => {
    // Upload files to the current directory
    uploadFiles(newFiles);
  };
  
  const uploadFiles = async (filesToUpload) => {
    try {
      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }
      
      if (!selectedChatId) {
        setError('No chat group selected. Please select a chat group first.');
        return;
      }
      
      // Check if the updateTelegramFileStructure function is available
      if (!window.updateTelegramFileStructure || typeof window.updateTelegramFileStructure !== 'function') {
        console.error('updateTelegramFileStructure function is not available');
        setError('File upload system is not properly initialized. Please refresh the page and try again.');
        return;
      }
      
      setError(null);
      setSuccess(null);
      setUploading(true);
      
      // Process files one by one
      for (const file of filesToUpload) {
        try {
          console.log(`Starting upload for file: ${file.name}`);
          
          // Check if file already exists in the current path
          const folderExists = findFolderByPath(fileStructure, currentPath);
          if (folderExists) {
            const fileExists = folderExists.files.some(f => f.filename === file.name);
            if (fileExists) {
              if (!window.confirm(`File ${file.name} already exists. Do you want to replace it?`)) {
                continue; // Skip this file if user doesn't want to replace
              }
              // If replacing, we'll continue with the upload
            }
          }
          
          // Read the file as an ArrayBuffer with proper error handling
          let fileBuffer;
          try {
            fileBuffer = await file.arrayBuffer();
          } catch (readError) {
            console.error(`Error reading file ${file.name}:`, readError);
            setError(`Failed to read file ${file.name}: ${readError.message || 'Unknown error'}`);
            continue;
          }
          
          // Create a Uint8Array from the ArrayBuffer and check if it's valid
          const fileData = new Uint8Array(fileBuffer);
          
          if (!fileData || fileData.length === 0) {
            setError(`Failed to read file ${file.name}: Empty file data`);
            continue;
          }
          
          // Check file size - Personal accounts can handle up to 2GB
          if (fileData.length > 2 * 1024 * 1024 * 1024) { // 2GB limit
            setError(`File ${file.name} is too large (${(fileData.length / (1024 * 1024)).toFixed(2)}MB). Maximum size is 2GB.`);
            continue;
          }
          
          // Show progress message
          setSuccess(`Uploading ${file.name} (${(fileData.length / 1024).toFixed(2)}KB)...`);
          
          // Send the file to Telegram with proper error handling
          console.log(`Uploading file: ${file.name}, size: ${fileData.length} bytes`);
          
          // Make sure we wait for any pending operations before sending
          await new Promise(resolve => setTimeout(resolve, 100));
          
          let result;
          let uploadPoster = null;
          if (isVideoFileName(file.name)) {
            try {
              uploadPoster = await generateVideoPosterJpeg(file);
            } catch (posterErr) {
              console.warn(`Poster generation skipped for ${file.name}:`, posterErr);
            }
          }

          const inputMessageContent = {
            '@type': 'inputMessageDocument',
            document: {
              '@type': 'inputFileBlob',
              name: file.name,
              data: file,
            },
            disable_content_type_detection: false,
          };

          if (uploadPoster?.blob) {
            inputMessageContent.thumbnail = {
              '@type': 'inputThumbnail',
              thumbnail: {
                '@type': 'inputFileBlob',
                name: 'thumb.jpg',
                data: uploadPoster.blob,
              },
              width: uploadPoster.width,
              height: uploadPoster.height,
            };
          }

          try {
            result = await telegramClient.send({
              '@type': 'sendMessage',
              chat_id: selectedChatId,
              input_message_content: inputMessageContent,
            });
            
            console.log('Upload result:', result);
          } catch (uploadError) {
            console.error(`Error during Telegram upload for ${file.name}:`, uploadError);
            setError(`Failed to upload ${file.name} to Telegram: ${uploadError.message || 'Unknown error'}`);
            continue;
          }
          
          if (result && result.id) {
            if (uploadPoster?.blob) {
              try {
                await setCachedPoster(selectedChatId, result.id, uploadPoster.blob, {
                  durationSec: null,
                  source: 'upload-jpeg',
                });
              } catch (cacheErr) {
                console.warn('Failed to cache upload poster:', cacheErr);
              }
            }
            // Add the file to our file structure
            const updatedStructure = addFile(fileStructure, currentPath, file.name, result.id);
            
            // Update the file structure in Telegram
            console.log('Updating file structure...');
            try {
              const success = await window.updateTelegramFileStructure(updatedStructure);
              
              if (success) {
                setSuccess(`Successfully uploaded ${file.name}`);
                console.log(`Successfully uploaded ${file.name}`);
              } else {
                setError(`Failed to update file structure for ${file.name}`);
                console.error(`Failed to update file structure for ${file.name}`);
              }
            } catch (updateError) {
              console.error(`Error updating file structure for ${file.name}:`, updateError);
              setError(`File uploaded but failed to update file structure: ${updateError.message || 'Unknown error'}`);
            }
          } else {
            setError(`Failed to upload ${file.name}: No message ID returned`);
            console.error(`Failed to upload ${file.name}: No message ID returned`, result);
          }
        } catch (fileError) {
          console.error(`Error uploading ${file.name}:`, fileError);
          setError(`Failed to upload ${file.name}: ${fileError.message || 'Unknown error'}`);
        }
      }
      
      setUploading(false);
    } catch (error) {
      console.error('Failed to upload files:', error);
      setError('Failed to upload files: ' + error.message);
      setUploading(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    handleFiles(selectedFiles);
  };
  
  // No external API is needed, we're using the Telegram client directly with selectedChatId

  const handleDeleteFile = async (fileName, e) => {
    e.stopPropagation(); // Prevent any parent click events
    
    if (!window.confirm(`Are you sure you want to delete the file "${fileName}"?`)) {
      return;
    }

    try {
      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }
      
      if (!selectedChatId) {
        setError('No chat group selected. Please select a chat group first.');
        return;
      }
      
      setError(null);
      setSuccess(null);
      
      // Find the file in the current folder to get its message_id
      const folder = findFolderByPath(fileStructure, currentPath);
      if (!folder) {
        setError(`Folder not found: ${currentPath}`);
        return;
      }
      
      const fileToDelete = folder.files.find(f => f.filename === fileName);
      if (!fileToDelete) {
        setError(`File not found: ${fileName}`);
        return;
      }
      
      const messageId = fileToDelete.message_id;
      if (!messageId) {
        setError(`No message ID found for file: ${fileName}`);
        return;
      }

      console.log("dry mode: ", isDryModeEnabled);
      // if there is no dry mode, assume it to be true by default. Safety first!

      let DRY_MODE;
      // if there is no dry mode, assume it to be true by default. Safety first!
      if (isDryModeEnabled === true || isDryModeEnabled === false) {
        DRY_MODE = isDryModeEnabled;
      } else {
        // if it is not true or false, assume it is a string and try to parse it
        DRY_MODE = true;
      }

      // Use isDryModeEnabled from TelegramContext

      if (!DRY_MODE) {
        // Delete the actual file message from Telegram
        try {
          await telegramClient.send({
            '@type': 'deleteMessages',
            'chat_id': selectedChatId,
            'message_ids': [messageId],
            'revoke': true
          });
          console.log(`Deleted message with ID: ${messageId}`);
        } catch (deleteError) {
          console.error(`Error deleting message: ${deleteError.message}`);
          // Continue with metadata deletion even if message deletion fails
        }
      } else {
          // Dry Mode: Log the message ID without deleting it with filename
          console.log(`Dry Mode enabled: Not deleting file: ${messageId} (${fileName})`);
      }
      
      // Delete file from the file structure
      const updatedStructure = deleteFile(fileStructure, currentPath, fileName);
      
      // Update the file structure in Telegram
      const success = await window.updateTelegramFileStructure(updatedStructure);
      
      if (success) {
        setSuccess(`File "${fileName}" deleted successfully`);
      } else {
        setError('Failed to delete file');
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
      setError('Failed to delete file: ' + error.message);
    }
  };

  // Handle file download
  const handleStreamPlay = async (fileName, e) => {
    e?.stopPropagation?.();
    streamDebug('play', 'handleStreamPlay click', {
      fileName,
      swController: !!navigator.serviceWorker?.controller,
    });

    try {
      if (!isConnected || !telegramClient) {
        streamDebugError('play', 'not connected', new Error('no telegramClient'));
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }
      if (!selectedChatId) {
        setError('No chat group selected.');
        return;
      }

      const folder = findFolderByPath(fileStructure, currentPath);
      if (!folder) {
        setError(`Folder not found: ${currentPath}`);
        return;
      }

      const fileEntry = folder.files.find((f) => f.filename === fileName);
      if (!fileEntry?.message_id) {
        setError(`No message ID for file: ${fileName}`);
        return;
      }

      setError(null);
      setSuccess(`Opening ${fileName}…`);

      const [resolved] = await Promise.all([
        resolveTelegramFile(
          telegramClient,
          selectedChatId,
          fileName,
          fileEntry.message_id,
        ),
        prepareForStreaming(telegramClient, { allowReload: true, timeoutMs: 12_000 }).catch(
          (prepareErr) => {
            streamDebugError('play', 'prepareForStreaming (parallel)', prepareErr);
          },
        ),
      ]);
      streamDebug('play', 'resolveTelegramFile OK', {
        fileName,
        fileId: resolved.fileId,
        size: resolved.size,
        messageId: resolved.messageId,
        metadataMessageId: fileEntry.message_id,
      });

      if (resolved.messageId !== fileEntry.message_id) {
        const updatedStructure = addFile(
          fileStructure,
          currentPath,
          fileName,
          resolved.messageId,
        );
        updateFileStructure(updatedStructure);
        window.updateTelegramFileStructure?.(updatedStructure).catch((syncError) => {
          console.warn('Background metadata message_id repair failed:', syncError);
        });
      }

      const streamUrl = getStreamUrl({
        fileId: resolved.fileId,
        size: resolved.size,
        mimeType: mimeTypeFromFileName(fileName),
        fileName,
      });
      streamDebug('play', 'stream URL built', { streamUrl, mime: mimeTypeFromFileName(fileName) });

      const headLimit = Math.min(
        resolved.size > 0 ? resolved.size : 1024 * 1024,
        1024 * 1024,
      );
      if (headLimit > 0) {
        requestTdlibFilePart(
          telegramClient,
          resolved.fileId,
          resolved.size,
          0,
          headLimit,
        ).catch((prefetchErr) => {
          streamDebugError('play', 'stream head prefetch', prefetchErr);
        });
      }

      registerPlaybackFileId(resolved.fileId);
      setStreamPlayer({
        open: true,
        url: streamUrl,
        title: fileName,
        fileId: resolved.fileId,
      });
      setSuccess(null);
    } catch (playError) {
      streamDebugError('play', 'handleStreamPlay failed', playError);
      setSuccess(null);
      setError(playError.message || 'Failed to start streaming playback.');
    }
  };

  const handleDownloadFile = async (fileName, e) => {
    e?.stopPropagation?.();

    try {
      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }
      if (!selectedChatId) {
        setError('No chat group selected. Please select a chat group first.');
        return;
      }

      const folder = findFolderByPath(fileStructure, currentPath);
      if (!folder) {
        setError(`Folder not found: ${currentPath}`);
        return;
      }

      const fileEntry = folder.files.find((f) => f.filename === fileName);
      if (!fileEntry?.message_id) {
        setError(`No message ID for file: ${fileName}`);
        return;
      }

      setError(null);
      setSuccess(`Downloading ${fileName}…`);

      const resolved = await resolveTelegramFile(
        telegramClient,
        selectedChatId,
        fileName,
        fileEntry.message_id,
      );

      if (resolved.messageId !== fileEntry.message_id) {
        const updatedStructure = addFile(
          fileStructure,
          currentPath,
          fileName,
          resolved.messageId,
        );
        updateFileStructure(updatedStructure);
        window.updateTelegramFileStructure?.(updatedStructure).catch((syncError) => {
          console.warn('Background metadata message_id repair failed:', syncError);
        });
      }

      const blob = await downloadTelegramFileAsBlob(
        telegramClient,
        {
          fileId: resolved.fileId,
          size: resolved.size,
          fileName,
        },
        {
          onProgress: (pct) => setSuccess(`Downloading ${fileName}… ${pct}%`),
        },
      );

      triggerBrowserFileDownload(blob, fileName);
      setSuccess(`Downloaded ${fileName} successfully`);
    } catch (error) {
      console.error('Failed to download file:', error);
      setError(`Failed to download file: ${error.message}`);
    }
  };


  return (
    <div className="file-explorer">
      <div className="file-explorer-nav">
        <div className="breadcrumb">
          <span 
            className="breadcrumb-item" 
            onClick={() => handlePathClick(0)}
          >
            <FaHome style={{ marginRight: '5px' }} /> Home
          </span>
          
          {currentPath !== '/' && currentPath.split('/').filter(Boolean).map((segment, index) => (
            <span 
              key={index} 
              className="breadcrumb-item"
              onClick={() => handlePathClick(index + 1)}
            >
              {segment}
            </span>
          ))}
        </div>
      </div>
      
      <div 
        className={`file-explorer-content ${isDragging ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragEnd={handleDragEnd}
      >
        {error && (
          <div className="error-message">
            <FaTrash style={{ marginRight: '8px' }} />
            {error}
          </div>
        )}
        
        {success && (
          <div className="success-message">
            <FaCheck style={{ marginRight: '8px' }} />
            {success}
          </div>
        )}
        
        <div className="action-buttons">
          <button 
            className="upload-button" 
            onClick={() => fileInputRef.current.click()}
          >
            <FaUpload /> Upload Files
          </button>
          
          <button 
            className="new-folder-button" 
            onClick={handleNewFolderClick}
          >
            <FaFolder /> New Folder
          </button>
          
          <UntrackedFilesToggle
            isPanelVisible={untrackedFilesState.isPanelVisible}
            count={untrackedFilesState.untrackedFiles.length}
            onToggle={untrackedFilesState.togglePanelVisibility}
          />

          {uploading && (
            <div className="loading-indicator">
              <div className="spinner"></div>
              Uploading...
            </div>
          )}
          
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={(e) => handleFiles(Array.from(e.target.files))}
            multiple
          />
        </div>

        <UntrackedFilesPanel
          slot="sheet"
          state={untrackedFilesState}
          currentPath={currentPath}
          onSuccess={setSuccess}
          onError={setError}
        />
        
        {currentPath !== '/' && (
          <div 
            className="parent-folder-drop-area"
            onClick={() => handlePathClick(currentPath.split('/').filter(Boolean).length - 1)}
            onDrop={(e) => handleFolderDrop(e)}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <FaArrowUp className="parent-folder-icon" />
            <span className="parent-folder-label">Go to parent folder</span>
          </div>
        )}
        
        <div className="file-grid">
          {currentFolder && currentFolder.subfolders && currentFolder.subfolders.length === 0 && 
           currentFolder.files && currentFolder.files.length === 0 ? (
            <div className={`empty-state ${isDragging ? 'drag-over' : ''}`}>
              <FaFolder style={{ fontSize: '48px', color: '#adb5bd', marginBottom: '16px' }} />
              <h3>This folder is empty</h3>
              <p>Drag and drop files here or use the upload button</p>
              <button 
                className="upload-button" 
                onClick={() => fileInputRef.current.click()}
              >
                <FaUpload /> Upload Files
              </button>
            </div>
          ) : (
            <>
              {currentFolder && currentFolder.subfolders && currentFolder.subfolders.map((folder) => (
                <div 
                  key={folder.name} 
                  className="file-item folder-item"
                  onClick={() => handleFolderClick(folder.name)}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', `folder:${currentPath === '/' ? `/${folder.name}` : `${currentPath}/${folder.name}`}`);
                  }}
                  onDragOver={(e) => handleFolderDragOver(e, folder.name)}
                  onDragLeave={handleFolderDragLeave}
                  onDrop={(e) => handleFolderDrop(e, folder.name)}
                >
                  <FaFolder style={{ fontSize: '42px', color: '#0088cc' }} />
                  <span className="file-name">{folder.name}</span>
                  <button 
                    className="delete-button"
                    onClick={(e) => handleDeleteFolder(folder.name, e)}
                    title="Delete folder"
                  >
                    <FaTrash />
                  </button>
                </div>
              ))}
              
              {currentFolder && currentFolder.files && currentFolder.files.map((file) => {
                const isVideo = isVideoFileName(file.filename);
                const isStreamable = isStreamableMediaFileName(file.filename);
                return (
                  <FileGridItem
                    key={file.filename}
                    filename={file.filename}
                    currentPath={currentPath}
                    isVideo={isVideo}
                    isStreamable={isStreamable}
                    onPlay={handleStreamPlay}
                    onDownload={handleDownloadFile}
                    onDelete={handleDeleteFile}
                    icon={getFileIcon(file.filename)}
                    poster={
                      isVideo && file.message_id && selectedChatId ? (
                        <VideoPosterTile
                          telegramClient={telegramClient}
                          chatId={selectedChatId}
                          messageId={file.message_id}
                          fileName={file.filename}
                          interactive
                        />
                      ) : null
                    }
                  />
                );
              })}
            </>
          )}
        </div>
      </div>
      <VideoPlayerModal
        open={streamPlayer.open}
        title={streamPlayer.title}
        streamUrl={streamPlayer.url}
        preparePlayback={preparePlayback}
        onClose={() => {
          if (streamPlayer.fileId != null) {
            unregisterPlaybackFileId(streamPlayer.fileId);
          }
          setStreamPlayer({ open: false, url: '', title: '', fileId: null });
        }}
      />
    </div>
  );
};

export default FileExplorer;