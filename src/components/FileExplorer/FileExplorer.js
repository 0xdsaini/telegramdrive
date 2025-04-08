import React, { useState, useRef, useEffect, useContext } from 'react';
import './FileExplorer.css';
import { FaFile, FaFileImage, FaFileAlt, FaFileCode, FaFolder, FaTrash, FaArrowUp, FaPlus, FaUpload, FaHome, FaCheck, FaDownload } from 'react-icons/fa';
import { createEmptyFileStructure, findFolderByPath, createFolder, deleteFolder, moveFolder, addFile, deleteFile, moveFile } from '../../utils/fileStructureUtils';
import { TelegramContext } from '../../context/TelegramContext';

(function() {
  const originalLog = console.log;
  let logData = [];

  console.log = function(...args) {
    const formattedArgs = args.map(arg => {
      if (typeof arg === 'object') {
        return JSON.stringify(arg, null, 2); // Properly format objects
      }
      return arg;
    });

    const logEntry = `[${new Date().toISOString()}] ${formattedArgs.join(' ')}`;
    logData.push(logEntry);
    originalLog.apply(console, args);
  };

  window.saveLogs = function() {
    const blob = new Blob([logData.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'console_logs.txt';
    a.click();
  };
})();


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
          try {
            result = await telegramClient.send({
              '@type': 'sendMessage',
              'chat_id': selectedChatId,
              'input_message_content': {
                '@type': 'inputMessageDocument',
                'document': {
                  '@type': 'inputFileBlob',
                  'name': file.name,
                  'data': file
                }
              }
            });
            
            console.log('Upload result:', result);
          } catch (uploadError) {
            console.error(`Error during Telegram upload for ${file.name}:`, uploadError);
            setError(`Failed to upload ${file.name} to Telegram: ${uploadError.message || 'Unknown error'}`);
            continue;
          }
          
          if (result && result.id) {
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
  const handleDownloadFile = async (fileName, e) => {
    e.stopPropagation(); // Prevent any parent click events
    
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
      
      const fileToDownload = folder.files.find(f => f.filename === fileName);
      if (!fileToDownload) {
        setError(`File not found: ${fileName}`);
        return;
      }
      
      const messageId = fileToDownload.message_id;
      if (!messageId) {
        setError(`No message ID found for file: ${fileName}`);
        return;
      }
      
      setSuccess(`Preparing to download ${fileName}...`);
      
      // Get the file directly from Telegram using TDLib
      try {
        // First, try to search for the message in case the stored ID is temporary
        console.log(`Attempting to find message with ID: ${messageId} for file: ${fileName}`);
        
        // Try to search for the message by content (filename)
        const searchResult = await telegramClient.send({
          '@type': 'searchChatMessages',
          'chat_id': selectedChatId,
          'query': fileName,
          'limit': 10,
          'from_message_id': 0,
          'offset': 0,
          'only_missed': false
        });
        
        console.log('Search results:', searchResult);
        
        let message = null;
        let fileId = null;
        
        // First try to find the message using the stored message ID
        try {
          message = await telegramClient.send({
            '@type': 'getMessage',
            'chat_id': selectedChatId,
            'message_id': messageId
          });
          console.log('Message retrieved by ID:', message);
        } catch (getMessageError) {
          console.log('Error retrieving message by ID:', getMessageError);
          message = null;
        }
        
        // If getMessage failed, try to find the message in search results
        if (!message && searchResult && searchResult.messages && searchResult.messages.length > 0) {
          // Look for a message that contains our file
          for (const msg of searchResult.messages) {
            if (msg.content && 
                ((msg.content['@type'] === 'messageDocument' && 
                  msg.content.document && 
                  msg.content.document.file_name === fileName) ||
                 (msg.content['@type'] === 'messageDocument' && 
                  msg.content.document && 
                  msg.content.document.document && 
                  msg.content.document.file_name === fileName))) {
              message = msg;
              console.log('Found message through search:', message);
              
              // Update the message ID in the file structure for future use
              const updatedStructure = addFile(fileStructure, currentPath, fileName, message.id);
              await window.updateTelegramFileStructure(updatedStructure);
              break;
            }
          }
        }
        
        // Check if message exists and has content
        if (!message || !message.content) {
          setError(`Message not found or has no content. The file may have been deleted from Telegram.`);
          return;
        }
        
        // Handle different message content types
        if (message.content['@type'] === 'messageDocument') {
          // Make sure document object exists and has the document property
          if (message.content.document && message.content.document.document) {
            fileId = message.content.document.document.id;
          } else if (message.content.document) {
            // Some versions of the API might have a different structure
            fileId = message.content.document.id;
          }
        } else if (message.content['@type'] === 'messagePhoto') {
          // Get the largest photo size
          // Check if photo object and sizes array exist
          if (message.content.photo && Array.isArray(message.content.photo.sizes) && message.content.photo.sizes.length > 0) {
            const photoSizes = message.content.photo.sizes;
            const largestPhoto = photoSizes.reduce((largest, current) => {
              return (current.width * current.height > largest.width * largest.height) ? current : largest;
            }, photoSizes[0]);
            
            if (largestPhoto && largestPhoto.photo) {
              fileId = largestPhoto.photo.id;
            }
          }
        } else if (message.content['@type'] === 'messageVideo') {
          if (message.content.video && message.content.video.video) {
            fileId = message.content.video.video.id;
          }
        } else if (message.content['@type'] === 'messageAudio') {
          if (message.content.audio && message.content.audio.audio) {
            fileId = message.content.audio.audio.id;
          }
        } else if (message.content['@type'] === 'messageAnimation') {
          if (message.content.animation && message.content.animation.animation) {
            fileId = message.content.animation.animation.id;
          }
        } else if (message.content['@type'] === 'messageVoiceNote') {
          if (message.content.voice_note && message.content.voice_note.voice) {
            fileId = message.content.voice_note.voice.id;
          }
        } else {
          setError(`Message does not contain a downloadable file (type: ${message.content['@type']})`);
          return;
        }
        
        if (!fileId) {
          console.error('Could not extract file ID from message:', message);
          setError(`Could not find file ID in message. The file format may not be supported or the message structure is unexpected.`);
          return;
        }
        
        console.log('File ID extracted:', fileId);
        
        // Get file info first to check size and availability
        let fileInfo;
        try {
          fileInfo = await telegramClient.send({
            '@type': 'getFile',
            'file_id': fileId
          });
          
          console.log('File info:', fileInfo);
          
          if (!fileInfo) {
            setError(`Error retrieving file info: No response received`);
            return;
          }
          
          if (fileInfo['@type'] === 'error') {
            console.error('Error in getFile response:', fileInfo);
            setError(`Error retrieving file info: ${fileInfo.message || 'Unknown error'} (Code: ${fileInfo.code || 'unknown'})`);
            return;
          }
        } catch (fileInfoError) {
          console.error('Exception during getFile:', fileInfoError);
          setError(`Error retrieving file info: ${fileInfoError.message || 'Unknown error'}`);
          return;
        }
        
        // Download the file using TDLib with streaming approach
        let downloadResult;
        try {
          downloadResult = await telegramClient.send({
            '@type': 'downloadFile',
            'file_id': fileId,
            'priority': 1,
            'offset': 0,
            'limit': 0,
            'synchronous': false // Use asynchronous download to avoid blocking UI
          });
          
          console.log('Download initiated:', downloadResult);
          
          if (downloadResult['@type'] === 'error') {
            console.error('Error in downloadFile response:', downloadResult);
            setError(`Error starting download: ${downloadResult.message} (Code: ${downloadResult.code || 'unknown'})`);
            return;
          }
        } catch (downloadError) {
          console.error('Exception during downloadFile:', downloadError);
          setError(`Error starting download: ${downloadError.message || 'Unknown error'}`);
          return;
        }
        
        // Set up a progress checker
        let downloadComplete = false;
        let downloadProgress = 0;
        let checkAttempts = 0;
        let consecutiveErrors = 0;
        let lastDownloadedSize = 0; // Track the last downloaded size for resuming
        const maxCheckAttempts = 60; // Check for up to 1 minute (60 * 1s)
        const maxConsecutiveErrors = 5; // Allow up to 5 consecutive errors before giving up
        
        const checkDownloadProgress = async () => {
          if (downloadComplete) {
            return;
          }
          
          // Check if we've reached the maximum attempts without completing the download
          if (checkAttempts >= maxCheckAttempts && !downloadComplete) {
            console.log(`Download timed out after ${maxCheckAttempts} seconds. Attempting to resume from offset ${lastDownloadedSize}`);
            setSuccess(`Download timed out. Resuming from ${Math.round(lastDownloadedSize / 1024)} KB...`);
            
            // Cancel the current download
            try {
              await telegramClient.send({
                '@type': 'cancelDownloadFile',
                'file_id': fileId,
                'only_if_pending': false
              });
            } catch (cancelError) {
              console.error('Error canceling download:', cancelError);
              // Continue even if cancel fails
            }
            
            // Reset attempts counter
            checkAttempts = 0;
            
            // Resume download from last offset
            try {
              await telegramClient.send({
                '@type': 'downloadFile',
                'file_id': fileId,
                'priority': 32,
                'offset': lastDownloadedSize,
                'limit': 0,
                'synchronous': false
              });
              
              // Continue checking progress
              setTimeout(checkDownloadProgress, 1000);
            } catch (resumeError) {
              console.error('Error resuming download:', resumeError);
              setError(`Failed to resume download: ${resumeError.message || 'Unknown error'}`);
            }
            
            return;
          }
          
          checkAttempts++;
          
          try {
            // Check current file status
            const currentFileInfo = await telegramClient.send({
              '@type': 'getFile',
              'file_id': fileId
            });
            
            if (currentFileInfo['@type'] === 'error') {
              console.error('Error checking file status:', currentFileInfo);
              consecutiveErrors++;
              
              if (consecutiveErrors >= maxConsecutiveErrors) {
                setError(`Error checking download status: ${currentFileInfo.message} (Code: ${currentFileInfo.code || 'unknown'}). Too many consecutive errors.`);
                return;
              }
              
              // Continue checking despite errors
              setTimeout(checkDownloadProgress, 1000);
              return;
            }
            
            // Reset consecutive errors counter on success
            consecutiveErrors = 0;
            
            if (currentFileInfo.local && currentFileInfo.local.is_downloading_completed) {
              downloadComplete = true;
              handleFileDownloadComplete(currentFileInfo, fileName);
              return;
            }
            
            // Update progress if available and track last downloaded size for resume capability
            if (currentFileInfo.local && currentFileInfo.local.downloaded_size > 0) {
              // Store the last downloaded size for resuming if needed
              lastDownloadedSize = currentFileInfo.local.downloaded_size;
              
              const newProgress = Math.round((currentFileInfo.local.downloaded_size / currentFileInfo.size) * 100);
              if (newProgress !== downloadProgress) {
                downloadProgress = newProgress;
                setSuccess(`Downloading ${fileName}... ${downloadProgress}%`);
              }
            } else {
              // If no progress yet, show a waiting message
              setSuccess(`Preparing download for ${fileName}... Please wait.`);
            }
            
            // Continue checking
            setTimeout(checkDownloadProgress, 1000);
          } catch (error) {
            console.error('Error checking download progress:', error);
            consecutiveErrors++;
            
            if (consecutiveErrors >= maxConsecutiveErrors) {
              setError(`Error checking download progress: ${error.message || 'Unknown error'}. Too many consecutive errors.`);
              return;
            }
            
            // Continue checking despite errors
            setTimeout(checkDownloadProgress, 1000);
          }
        };
        
        // Start progress checking
        checkDownloadProgress();
        
        // Function to handle completed download
        const handleFileDownloadComplete = (completedFile, fileName) => {
          try {
            console.log('Handling completed download for file:', fileName, completedFile);
            
            if (completedFile.local && completedFile.local.is_downloading_completed) {
              if (completedFile.local.path) {
                // Create a blob URL from the file data
                const filePath = completedFile.local.path;
                console.log('Download completed, file path:', filePath);
                
                // Check if we can access the file directly
                if (window.tdweb && typeof window.tdweb.getFileBlob === 'function') {
                  // Use TDWeb's getFileBlob function if available
                  window.tdweb.getFileBlob(filePath)
                    .then(blob => {
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = fileName;
                      document.body.appendChild(link);
                      link.click();
                      document.body.removeChild(link);
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                      setSuccess(`Downloaded ${fileName} successfully`);
                    })
                    .catch(error => {
                      console.error('Error getting file blob:', error);
                      // Fall back to blob approach
                      handleBlobDownload(completedFile, fileName);
                    });
                  return;
                }
                
                // If TDWeb's getFileBlob is not available, try to read the file directly
                try {
                  // Use readFilePart to get the file data directly
                  const fileData = telegramClient.send({
                    '@type': 'readFilePart',
                    'file_id': completedFile.id,
                    'offset': 0,
                    'count': completedFile.size
                  });
                  
                  if (fileData && fileData.data) {
                    // Create a blob from the file data
                    let blob;
                    if (typeof fileData.data === 'string') {
                      // Handle base64 string
                      try {
                        const byteCharacters = atob(fileData.data);
                        const byteArrays = [];
                        
                        for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
                          const slice = byteCharacters.slice(offset, offset + 1024);
                          const byteNumbers = new Array(slice.length);
                          
                          for (let i = 0; i < slice.length; i++) {
                            byteNumbers[i] = slice.charCodeAt(i);
                          }
                          
                          byteArrays.push(new Uint8Array(byteNumbers));
                        }
                        
                        blob = new Blob(byteArrays);
                      } catch (error) {
                        console.error('Error processing base64 data:', error);
                        throw error;
                      }
                    } else if (fileData.data instanceof Uint8Array || fileData.data instanceof ArrayBuffer) {
                      // Handle binary data
                      blob = new Blob([fileData.data]);
                    } else {
                      console.error('Unsupported data type:', typeof fileData.data);
                      throw new Error(`Unsupported file data format: ${typeof fileData.data}`);
                    }
                    
                    // Create download link
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = fileName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    
                    setSuccess(`Downloaded ${fileName} successfully`);
                    return;
                  }
                } catch (pathError) {
                  console.error('Error with direct file download:', pathError);
                  // Continue to blob approach
                }
              }
            }
            
            // If we get here, either the path is not available or download is not complete
            // Try the blob approach as fallback
            console.log('Path not available or download not complete, trying blob approach');
            handleBlobDownload(completedFile, fileName);
          } catch (error) {
            console.error('Error handling completed download:', error);
            setError(`Error processing downloaded file: ${error.message}`);
          }
        };
        
        // Fallback method using Blob
        const handleBlobDownload = async (fileInfo, fileName) => {
          try {
            console.log('Starting blob download for file:', fileInfo);
            
            // Make sure we have a valid file ID
            if (!fileInfo || !fileInfo.id) {
              throw new Error('Invalid file information: missing file ID');
            }
            
            // Make sure we have a valid file size
            if (!fileInfo.size || fileInfo.size <= 0) {
              throw new Error('Invalid file size: ' + (fileInfo.size || 'unknown'));
            }
            
            // Try to download using TDLib's downloadFile first if the file isn't already downloaded
            if (!fileInfo.local || !fileInfo.local.is_downloading_completed) {
              setSuccess(`Downloading ${fileName}... Please wait.`);
              try {
                // Get current download state to check for partial downloads
                const currentFileState = await telegramClient.send({
                  '@type': 'getFile',
                  'file_id': fileInfo.id
                });
                
                // Determine if we have a partial download to resume from
                let startOffset = 0;
                if (currentFileState && 
                    currentFileState.local && 
                    currentFileState.local.downloaded_size > 0 && 
                    !currentFileState.local.is_downloading_completed) {
                  startOffset = currentFileState.local.downloaded_size;
                  console.log(`Resuming download from offset: ${startOffset} bytes`);
                  setSuccess(`Resuming download of ${fileName} from ${Math.round(startOffset/1024)} KB...`);
                }
                
                // Force a synchronous download from the appropriate offset
                const downloadResult = await telegramClient.send({
                  '@type': 'downloadFile',
                  'file_id': fileInfo.id,
                  'priority': 32, // Higher priority
                  'offset': startOffset,
                  'limit': 0,
                  'synchronous': true // Use synchronous download to ensure completion
                });
                
                console.log('Forced download result:', downloadResult);
                
                // Update fileInfo with the latest data
                if (downloadResult && downloadResult.id) {
                  fileInfo = downloadResult;
                }
              } catch (downloadError) {
                console.error('Error during forced download:', downloadError);
                // Continue with readFilePart approach even if download fails
              }
            }
            
            // Try to use local path if available after download
            if (fileInfo.local && 
                fileInfo.local.is_downloading_completed && 
                fileInfo.local.path && 
                window.tdweb && 
                typeof window.tdweb.getFileBlob === 'function') {
              try {
                const blob = await window.tdweb.getFileBlob(fileInfo.local.path);
                if (blob && blob.size > 0) {
                  // Create download link
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = fileName;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  setSuccess(`Downloaded ${fileName} successfully`);
                  return;
                }
              } catch (pathError) {
                console.error('Error using local path:', pathError);
                // Continue with readFilePart approach
              }
            }
            
            // Try alternative approach first - get file content directly
            try {
              setSuccess(`Downloading ${fileName} using direct method...`);
              
              // Try to get the file directly from TDLib
              const directFileResult = await telegramClient.send({
                '@type': 'getRemoteFile',
                'remote_file_id': fileInfo.remote?.id,
                'file_type': {
                  '@type': 'fileTypeDocument'
                }
              });
              
              console.log('Direct file result:', directFileResult);
              
              if (directFileResult && directFileResult.id && directFileResult.id !== fileInfo.id) {
                // Update fileInfo with the new file data
                fileInfo = await telegramClient.send({
                  '@type': 'getFile',
                  'file_id': directFileResult.id
                });
                console.log('Updated file info:', fileInfo);
              }
            } catch (directError) {
              console.error('Error getting file directly:', directError);
              // Continue with readFilePart approach
            }
            
            // Read the file as a blob with retry mechanism
            let fileBlob = null;
            let retryCount = 0;
            const maxRetries = 5; // Increased retries
            
            while (retryCount < maxRetries) {
              try {
                setSuccess(`Downloading ${fileName}... Attempt ${retryCount + 1}/${maxRetries}`);
                
                fileBlob = await telegramClient.send({
                  '@type': 'readFilePart',
                  'file_id': fileInfo.id,
                  'offset': 0,
                  'count': fileInfo.size
                });
                
                if (fileBlob && fileBlob['@type'] !== 'error' && fileBlob.data) {
                  break; // Success, exit retry loop
                }
                
                console.log(`Retry ${retryCount + 1}/${maxRetries} for readFilePart failed:`, fileBlob);
                retryCount++;
                
                // Wait before retrying with increasing delay
                await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
              } catch (retryError) {
                console.error(`Retry ${retryCount + 1}/${maxRetries} error:`, retryError);
                retryCount++;
                
                // Wait before retrying with increasing delay
                await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
              }
            }
            
            if (!fileBlob || fileBlob['@type'] === 'error') {
              throw new Error(`Failed to read file data after ${maxRetries} attempts: ${fileBlob?.message || 'Unknown error'} (Code: ${fileBlob?.code || 'unknown'})`);
            }
            
            if (!fileBlob.data) {
              throw new Error('No file data received from readFilePart');
            }
            
            // Convert data to blob with better error handling
            let blob;
            try {
              console.log('Processing file data of type:', typeof fileBlob.data);
              
              if (typeof fileBlob.data === 'string') {
                console.log('Converting base64 string to blob');
                // Check if it's a base64 string
                let byteCharacters;
                try {
                  // Try to decode as base64
                  byteCharacters = atob(fileBlob.data);
                } catch (base64Error) {
                  console.error('Error decoding base64:', base64Error);
                  // If not base64, try to parse as JSON to see if it contains file data
                  try {
                    const jsonData = JSON.parse(fileBlob.data);
                    if (jsonData && jsonData.data) {
                      // If JSON contains data field, try to use that as base64
                      try {
                        byteCharacters = atob(jsonData.data);
                      } catch (nestedBase64Error) {
                        console.error('Error decoding nested base64:', nestedBase64Error);
                        // If not base64, use as-is
                        byteCharacters = jsonData.data;
                      }
                    } else {
                      // Otherwise use as-is
                      byteCharacters = fileBlob.data;
                    }
                  } catch (jsonError) {
                    // If not JSON either, use as-is
                    console.error('Error parsing JSON:', jsonError);
                    byteCharacters = fileBlob.data;
                  }
                }
                
                const byteArrays = [];
                
                for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
                  const slice = byteCharacters.slice(offset, offset + 1024);
                  const byteNumbers = new Array(slice.length);
                  
                  for (let i = 0; i < slice.length; i++) {
                    byteNumbers[i] = slice.charCodeAt(i);
                  }
                  
                  byteArrays.push(new Uint8Array(byteNumbers));
                }
                
                blob = new Blob(byteArrays);
              } else if (fileBlob.data instanceof Uint8Array) {
                console.log('Converting Uint8Array to blob');
                // Already a binary array
                blob = new Blob([fileBlob.data]);
              } else if (fileBlob.data instanceof ArrayBuffer) {
                console.log('Converting ArrayBuffer to blob');
                // Handle ArrayBuffer
                blob = new Blob([new Uint8Array(fileBlob.data)]);
              } else if (fileBlob.data instanceof Blob) {
                console.log('Data is already a Blob');
                // Already a blob
                blob = fileBlob.data;
              } else {
                console.error('Unsupported data type:', typeof fileBlob.data, fileBlob.data);
                throw new Error(`Unsupported file data format: ${typeof fileBlob.data}`);
              }
              
              if (!blob || blob.size === 0) {
                throw new Error('Created blob is empty');
              }
              
              console.log(`Created blob of size: ${blob.size} bytes`);
            } catch (blobError) {
              console.error('Error creating blob:', blobError);
              throw new Error(`Failed to create blob: ${blobError.message}`);
            }
            
            // Create download link with proper MIME type detection
            let mimeType = 'application/octet-stream'; // Default MIME type
            
            // Try to determine MIME type from file extension
            const extension = fileName.split('.').pop().toLowerCase();
            if (extension) {
              // Common MIME types mapping
              const mimeTypes = {
                'pdf': 'application/pdf',
                'jpg': 'image/jpeg',
                'jpeg': 'image/jpeg',
                'png': 'image/png',
                'gif': 'image/gif',
                'svg': 'image/svg+xml',
                'txt': 'text/plain',
                'html': 'text/html',
                'css': 'text/css',
                'js': 'text/javascript',
                'json': 'application/json',
                'xml': 'application/xml',
                'zip': 'application/zip',
                'doc': 'application/msword',
                'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'xls': 'application/vnd.ms-excel',
                'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'ppt': 'application/vnd.ms-powerpoint',
                'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'mp3': 'audio/mpeg',
                'mp4': 'video/mp4',
                'wav': 'audio/wav',
                'avi': 'video/x-msvideo',
                'mov': 'video/quicktime'
              };
              
              if (mimeTypes[extension]) {
                mimeType = mimeTypes[extension];
              }
            }
            
            console.log(`Using MIME type: ${mimeType} for file: ${fileName}`);
            const url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
            
            // Create and trigger download link
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            link.style.display = 'none';
            document.body.appendChild(link);
            
            // Use a small timeout to ensure the browser has time to create the object URL
            setTimeout(() => {
              link.click();
              document.body.removeChild(link);
              
              // Clean up the object URL after download starts
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              
              setSuccess(`Downloaded ${fileName} successfully`);
            }, 100);
          } catch (error) {
            console.error('Error in blob download:', error);
            setError(`Failed to download file: ${error.message}`);
          }
        };
      } catch (downloadError) {
        console.error('Error downloading file:', downloadError);
        setError(`Error downloading file: ${downloadError.message}`);
      }
    } catch (error) {
      console.error('Failed to download file:', error);
      setError('Failed to download file: ' + error.message);
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
              
              {currentFolder && currentFolder.files && currentFolder.files.map((file) => (
                <div 
                  key={file.filename} 
                  className="file-item"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', `file:${currentPath === '/' ? `/${file.filename}` : `${currentPath}/${file.filename}`}`);
                  }}
                >
                  {getFileIcon(file.filename)}
                  <span className="file-name">{file.filename}</span>
                  <button 
                    className="download-button"
                    onClick={(e) => handleDownloadFile(file.filename, e)}
                    title="Download file"
                  >
                    <FaDownload />
                  </button>
                  <button 
                    className="delete-button"
                    onClick={(e) => handleDeleteFile(file.filename, e)}
                    title="Delete file"
                  >
                    <FaTrash />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default FileExplorer;