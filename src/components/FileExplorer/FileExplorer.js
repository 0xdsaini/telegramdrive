import React, { useState, useRef, useEffect, useContext } from 'react';
import './FileExplorer.css';
import { FaFile, FaFileImage, FaFileAlt, FaFileCode, FaFolder, FaTrash, FaArrowUp } from 'react-icons/fa';
import { createEmptyFileStructure, findFolderByPath, createFolder, deleteFolder, moveFolder, addFile, deleteFile, moveFile } from '../../utils/fileStructureUtils';
import { TelegramContext } from '../../context/TelegramContext';
import { CHAT_ID } from '../TelegramMessenger/constants';

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
  
  // Access the Telegram context
  const { 
    fileStructure, 
    updateFileStructure, 
    isFileStructureLoaded, 
    isConnected,
    telegramClient
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
      
      // Validate folder name
      if (!folderName || folderName.includes('/')) {
        setError('Invalid folder name. Folder name cannot be empty or contain "/"');
        return;
      }
      
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
      
      // Delete folder from the file structure
      const updatedStructure = deleteFolder(fileStructure, folderPath);
      
      // Update the file structure in Telegram
      const success = await window.updateTelegramFileStructure(updatedStructure);
      
      if (success) {
        setSuccess(`Folder "${folderName}" deleted successfully`);
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
    
    // Handle folder drops
    if (dragData.startsWith('folder:')) {
      const sourcePath = dragData.replace('folder:', '');
      
      // Check if we're dropping on a specific folder or in the current directory
      const destPath = folderName ? 
        (currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`) : 
        currentPath;
      
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
      
      // Set destination path as the folder we're dropping into
      const destPath = folderName ? 
        (currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`) : 
        currentPath;
      
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
          
          // Check file size - TDLib has limitations
          if (fileData.length > 50 * 1024 * 1024) { // 50MB limit
            setError(`File ${file.name} is too large (${(fileData.length / (1024 * 1024)).toFixed(2)}MB). Maximum size is 50MB.`);
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
              'chat_id': CHAT_ID,
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
  
  // Base URL for API endpoints
  const API_BASE_URL = 'https://ee44-192-140-152-195.ngrok-free.app';

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
      
      setError(null);
      setSuccess(null);
      
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

  return (
    <div className="file-explorer">
      <nav className="file-explorer-nav">
        <div className="breadcrumb">
          {currentPath.split('/').map((segment, index) => (
            <span 
              key={index} 
              className="breadcrumb-item"
              onClick={() => handlePathClick(index)}
            >
              {segment || 'Home'}
            </span>
          ))}
        </div>
        <button 
          className="new-folder-button" 
          onClick={handleNewFolderClick}
          disabled={!isConnected}
        >
          New Folder
        </button>
      </nav>
      
      <main 
        className="file-explorer-content"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragEnd={handleDragEnd}
      >
        <div className="action-buttons">
          <button 
            className="upload-button" 
            onClick={handleUploadClick} 
            disabled={uploading || !isConnected}
          >
            {uploading ? 'Uploading...' : 'Upload Files'}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileSelect}
            multiple
          />
          {uploading && <div className="loading-indicator">Uploading files, please wait...</div>}
        </div>
        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}
        
        {/* Parent folder drop area - only show when not in root directory */}
        {currentPath !== '/' && (
          <div 
            className="parent-folder-drop-area"
            onDrop={async (e) => {
              e.preventDefault();
              e.stopPropagation();
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
              
              // Get parent path
              const pathSegments = currentPath.split('/').filter(Boolean);
              const parentPathSegments = pathSegments.slice(0, -1);
              const parentPath = parentPathSegments.length === 0 ? '/' : '/' + parentPathSegments.join('/');
              
              // Handle folder drops to parent directory
              if (dragData.startsWith('folder:')) {
                const sourcePath = dragData.replace('folder:', '');
                
                // Normalize paths for comparison
                const normalizedSourcePath = sourcePath.startsWith('/') ? sourcePath : `/${sourcePath}`;
                const normalizedParentPath = parentPath.startsWith('/') ? parentPath : `/${parentPath}`;
                
                // Don't allow invalid moves
                if (normalizedSourcePath === normalizedParentPath || normalizedParentPath.startsWith(normalizedSourcePath + '/')) {
                  setError('Cannot move a folder into itself or its subfolder');
                  return;
                }
                
                try {
                  setError(null);
                  setSuccess(null);
                  
                  // Move folder to parent directory
                  const updatedStructure = moveFolder(fileStructure, sourcePath, parentPath);
                  
                  // Update the file structure in Telegram
                  const success = await window.updateTelegramFileStructure(updatedStructure);
                  
                  if (success) {
                    setSuccess(`Folder moved successfully to parent folder`);
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
                
                // Get the parent path of the source file
                const sourcePathSegments = sourceFilePath.split('/').filter(Boolean);
                const sourceParentPathSegments = sourcePathSegments.slice(0, -1);
                const sourceParentPath = sourceParentPathSegments.length === 0 ? '/' : '/' + sourceParentPathSegments.join('/');
                
                try {
                  setError(null);
                  setSuccess(null);
                  
                  // Move file to parent directory
                  const updatedStructure = moveFile(fileStructure, sourceParentPath, fileName, parentPath);
                  
                  // Update the file structure in Telegram
                  const success = await window.updateTelegramFileStructure(updatedStructure);
                  
                  if (success) {
                    setSuccess(`File "${fileName}" moved successfully to parent folder`);
                  } else {
                    setError('Failed to move file');
                  }
                } catch (error) {
                  console.error('Failed to move file:', error);
                  setError('Failed to move file: ' + error.message);
                }
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.add('drag-over');
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.classList.remove('drag-over');
            }}
          >
            <FaArrowUp size={20} />
            <span style={{ marginLeft: '10px' }}>Drop here to move to parent folder</span>
          </div>
        )}
        
        <div className="file-grid">
          {!currentFolder ? (
            <div className="empty-state">
              <p>Loading...</p>
            </div>
          ) : currentFolder.subfolders.length === 0 && currentFolder.files.length === 0 ? (
            <div 
              className="empty-state"
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove('drag-over');
                
                if (e.dataTransfer.files.length > 0) {
                  const droppedFiles = Array.from(e.dataTransfer.files);
                  setSuccess(`Preparing to upload ${droppedFiles.length} file(s)...`);
                  handleFiles(droppedFiles);
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.add('drag-over');
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove('drag-over');
              }}
            >
              <p>This folder is empty</p>
              <p>Drop files here to upload</p>
              <button className="upload-button" onClick={handleUploadClick}>Select Files</button>
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                onChange={handleFileSelect}
                multiple
              />
            </div>
          ) : (
            <>
              {currentFolder.subfolders.map((folder, index) => (
                <div 
                key={`folder-${index}`} 
                className="file-item"
                draggable="true"
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', `folder:${currentPath === '/' ? folder.name : `${currentPath}/${folder.name}`}`);
                }}
                onDragOver={(e) => handleFolderDragOver(e, folder.name)}
                onDragLeave={handleFolderDragLeave}
                onDrop={(e) => handleFolderDrop(e, folder.name)}
                onDragEnd={handleDragEnd}
              >
                  <div onClick={() => handleFolderClick(folder.name)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div className="file-icon"><FaFolder /></div>
                      <span className="file-name">{folder.name}</span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteFolder(folder.name, e)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#dc3545',
                        padding: '4px',
                        marginLeft: '8px'
                      }}
                      title="Delete folder"
                    >
                      <FaTrash size={14} />
                    </button>
                  </div>
                </div>
              ))}
              {currentFolder.files.map((file, index) => (
                <div 
                  key={`file-${file.message_id || index}`} 
                  className="file-item"
                  draggable="true"
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', `file:${currentPath === '/' ? file.filename : `${currentPath}/${file.filename}`}`);
                  }}
                  onDragEnd={handleDragEnd}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div className="file-icon">{getFileIcon(file.filename)}</div>
                      <span className="file-name">{file.filename}</span>
                    </div>
                    <button
                      onClick={(e) => handleDeleteFile(file.filename, e)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#dc3545',
                        padding: '4px',
                        marginLeft: '8px'
                      }}
                      title="Delete file"
                    >
                      <FaTrash size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default FileExplorer;