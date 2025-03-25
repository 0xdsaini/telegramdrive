import React, { useState, useRef, useEffect } from 'react';
import './FileExplorer.css';
import { FaFile, FaFileImage, FaFileAlt, FaFileCode, FaFolder, FaTrash, FaArrowUp } from 'react-icons/fa';

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
  const [fileStructure, setFileStructure] = useState(null);
  const [currentPath, setCurrentPath] = useState('/');
  const [currentFolder, setCurrentFolder] = useState(null);
  const [files, setFiles] = useState([]);
  const fileInputRef = useRef(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchFileStructure();
  }, []);

  const createFolder = async (folderName) => {
    try {
      setError(null);
      setSuccess(null);
      
      const response = await fetch('https://ee44-192-140-152-195.ngrok-free.app/folder/create', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          parent_path: currentPath,
          folder_name: folderName
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.detail || 'Failed to create folder');
        return;
      }

      setSuccess(data.message);
      fetchFileStructure(); // Refresh the file structure
    } catch (error) {
      setError('Failed to create folder: ' + error.message);
    }
  };

  const handleNewFolderClick = () => {
    const folderName = prompt('Enter folder name:');
    if (folderName) {
      createFolder(folderName);
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
      
      const folderPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
      const response = await fetch('https://ee44-192-140-152-195.ngrok-free.app/folder/delete', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          folder_path: folderPath
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.detail || 'Failed to delete folder');
        return;
      }

      setSuccess(data.message);
      fetchFileStructure(); // Refresh the file structure
    } catch (error) {
      setError('Failed to delete folder: ' + error.message);
    }
  };

  const fetchFileStructure = async () => {
    try {
      console.log('Attempting to fetch file structure...');
      const response = await fetch('https://ee44-192-140-152-195.ngrok-free.app/get_metadata', {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('Response is not JSON');
      }
      const data = await response.json();
      
      const processedData = {
        name: 'root',
        files: Array.isArray(data.files) ? data.files.map(file => ({
          filename: file.filename || file.name,
          message_id: file.message_id,
          size: file.size,
          type: file.type
        })) : [],
        subfolders: Array.isArray(data.subfolders) ? data.subfolders.map(folder => ({
          name: folder.name,
          files: folder.files || [],
          subfolders: folder.subfolders || []
        })) : []
      };
      
      setFileStructure(processedData);
      
      // Update current folder based on current path
      if (currentPath === '/') {
        setCurrentFolder(processedData);
      } else {
        const pathSegments = currentPath.split('/').filter(Boolean);
        let current = processedData;
        
        for (const segment of pathSegments) {
          const nextFolder = current.subfolders.find(folder => folder.name === segment);
          if (!nextFolder) {
            // If folder not found, reset to root
            setCurrentPath('/');
            setCurrentFolder(processedData);
            return;
          }
          current = nextFolder;
        }
        setCurrentFolder(current);
      }
    } catch (error) {
      console.error('Error setting up file structure:', error);
      const emptyStructure = { name: 'root', files: [], subfolders: [] };
      setFileStructure(emptyStructure);
      setCurrentFolder(emptyStructure);
      setCurrentPath('/');
    }
  };
  
  const updateCurrentFolder = (structure, path) => {
    if (path === '/') {
      setCurrentFolder(structure);
      return;
    }

    const pathSegments = path.split('/').filter(Boolean);
    let current = structure;

    for (const segment of pathSegments) {
      current = current.subfolders.find(folder => folder.name === segment);
      if (!current) break;
    }

    setCurrentFolder(current || structure);
  };

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
      
      // Get the parent path of the source folder
      const sourcePathSegments = sourcePath.split('/').filter(Boolean);
      const sourceParentPathSegments = sourcePathSegments.slice(0, -1);
      const sourceParentPath = sourceParentPathSegments.length === 0 ? '/' : '/' + sourceParentPathSegments.join('/');
      
      // Normalize paths for comparison
      const normalizedSourcePath = sourcePath.startsWith('/') ? sourcePath : `/${sourcePath}`;
      const normalizedDestPath = destPath.startsWith('/') ? destPath : `/${destPath}`;
      const normalizedSourceParentPath = sourceParentPath.startsWith('/') ? sourceParentPath : `/${sourceParentPath}`;
      
      // Check if we're dropping to the same folder (current location)
      if (normalizedSourceParentPath === normalizedDestPath) {
        setSuccess('Folder is already in this location');
        return;
      }
      
      // Don't allow dropping a folder into itself or its child
      // Normalize paths for proper comparison
      const normalizedSourcePathForComparison = normalizedSourcePath.endsWith('/') ? normalizedSourcePath : `${normalizedSourcePath}/`;
      const normalizedDestPathForComparison = normalizedDestPath.endsWith('/') ? normalizedDestPath : `${normalizedDestPath}/`;
      
      // Check if source and destination are the same folder
      if (normalizedSourcePath === normalizedDestPath) {
        setError('Cannot move a folder into itself');
        return;
      }
      
      // Check if destination is a subfolder of source
      if (normalizedDestPathForComparison.startsWith(normalizedSourcePathForComparison)) {
        setError('Cannot move a folder into its subfolder');
        return;
      }
      
      console.log('Source Path:', sourcePath);
      console.log('Destination Path:', destPath);
    
      try {
        setError(null);
        setSuccess(null);
        
        const response = await fetch('https://ee44-192-140-152-195.ngrok-free.app/folder/move', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            source_path: sourcePath,
            dest_path: destPath
          })
        });

        const data = await response.json();

        if (!response.ok) {
          setError(data.detail || 'Failed to move folder');
          return;
        }

        setSuccess(data.message);
        fetchFileStructure(); // Refresh the file structure
      } catch (error) {
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
      
      // Normalize paths for comparison
      const normalizedSourceParentPath = sourceParentPath.startsWith('/') ? sourceParentPath : `/${sourceParentPath}`;
      const normalizedDestPath = destPath.startsWith('/') ? destPath : `/${destPath}`;
      
      // Check if we're dropping to the same folder (current location)
      // We need to compare both the normalized paths AND the original paths
      // This ensures we can move between sibling directories with similar names
      // For sibling folders, we need to check the full path including the filename
      const sourceFullPath = sourceFilePath;
      const destFullPath = destPath === '/' ? `/${fileName}` : `${destPath}/${fileName}`;
      
      if (sourceFullPath === destFullPath) {
        setSuccess('File is already in this location');
        return;
      }
      
      // If the file is in a sibling folder, allow the move to proceed
      // No additional check needed here as we want to allow moves between sibling folders
      
      console.log('Source File Path:', sourceFilePath);
      console.log('Destination Path:', destPath);
    
      try {
        setError(null);
        setSuccess(null);
        
        const response = await fetch('https://ee44-192-140-152-195.ngrok-free.app/file/move', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            source_path: sourceParentPath,
            filename: fileName,
            dest_path: destPath
          })
        });

        const data = await response.json();

        if (!response.ok) {
          setError(data.detail || 'Failed to move file');
          return;
        }

        setSuccess(data.message || 'File moved successfully');
        fetchFileStructure(); // Refresh the file structure
      } catch (error) {
        setError('Failed to move file: ' + error.message);
      }
    }
  };

  const handleFiles = (newFiles) => {
    // Add files to the state
    setFiles(prevFiles => [
      ...prevFiles,
      ...newFiles.map(file => ({
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        file: file // Store the actual file object for upload
      }))
    ]);
    
    // Upload files to the current directory
    uploadFiles(newFiles);
  };
  
  const uploadFiles = async (filesToUpload) => {
    try {
      setError(null);
      setSuccess(null);
      setUploading(true);
      
      for (const file of filesToUpload) {
        const formData = new FormData();
        formData.append('folder_path', currentPath);
        formData.append('file', file);
        
        const response = await fetch('https://ee44-192-140-152-195.ngrok-free.app/file/upload', {
          method: 'POST',
          body: formData
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          // Handle error response format
          if (data.detail && Array.isArray(data.detail)) {
            const errorMessages = data.detail.map(err => err.msg || 'Unknown error').join(', ');
            setError(`Failed to upload ${file.name}: ${errorMessages}`);
          } else {
            setError(data.detail || `Failed to upload ${file.name}`);
          }
          setUploading(false);
          return;
        }
        
        // Handle success response format
        if (data.message_id && Array.isArray(data.message_id) && data.message_id.length > 1) {
          setSuccess(data.message_id[1] || `Successfully uploaded ${file.name}`);
        } else {
          setSuccess(data.message || `Successfully uploaded ${file.name}`);
        }
      }
      
      // Refresh the file structure after upload
      fetchFileStructure();
      setUploading(false);
    } catch (error) {
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
      setError(null);
      setSuccess(null);
      
      const folderPath = currentPath;
      const response = await fetch(`${API_BASE_URL}/file/delete`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          folder_path: folderPath,
          filename: fileName
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.detail || 'Failed to delete file');
        return;
      }

      setSuccess(data.message || `Successfully deleted ${fileName}`);
      fetchFileStructure(); // Refresh the file structure
    } catch (error) {
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
        <button className="new-folder-button" onClick={handleNewFolderClick}>New Folder</button>
      </nav>
      
      <main 
        className="file-explorer-content"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragEnd={handleDragEnd}
      >
        <div className="action-buttons">
          <button className="upload-button" onClick={handleUploadClick} disabled={uploading}>
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
                
                // Move folder to parent directory
                (async () => {
                  try {
                    setError(null);
                    setSuccess(null);
                    
                    const response = await fetch('https://ee44-192-140-152-195.ngrok-free.app/folder/move', {
                      method: 'POST',
                      headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        source_path: sourcePath,
                        dest_path: parentPath
                      })
                    });

                    const data = await response.json();

                    if (!response.ok) {
                      setError(data.detail || 'Failed to move folder');
                      return;
                    }

                    setSuccess(data.message);
                    fetchFileStructure(); // Refresh the file structure
                  } catch (error) {
                    setError('Failed to move folder: ' + error.message);
                  }
                })();
              }
              // Handle file drops
              else if (dragData.startsWith('file:')) {
                const sourceFilePath = dragData.replace('file:', '');
                const fileName = sourceFilePath.split('/').pop();
                
                // Get the parent path of the source file
                const sourcePathSegments = sourceFilePath.split('/').filter(Boolean);
                const sourceParentPathSegments = sourcePathSegments.slice(0, -1);
                const sourceParentPath = sourceParentPathSegments.length === 0 ? '/' : '/' + sourceParentPathSegments.join('/');
                
                // Normalize paths for comparison
                const normalizedSourceParentPath = sourceParentPath.startsWith('/') ? sourceParentPath : `/${sourceParentPath}`;
                const normalizedParentPath = parentPath.startsWith('/') ? parentPath : `/${parentPath}`;
                
                // Check if we're dropping to the same folder
                // Compare both normalized and original paths to ensure accurate comparison
                if (normalizedSourceParentPath === normalizedParentPath && sourceParentPath === parentPath) {
                  setSuccess('File is already in this location');
                  return;
                }
                // We don't need additional checks here - if paths are different, allow the move
                
                try {
                  setError(null);
                  setSuccess(null);
                  
                  const response = await fetch('https://ee44-192-140-152-195.ngrok-free.app/file/move', {
                    method: 'POST',
                    headers: {
                      'Accept': 'application/json',
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      source_path: sourceParentPath,
                      filename: fileName,
                      dest_path: parentPath
                    })
                  });

                  const data = await response.json();

                  if (!response.ok) {
                    setError(data.detail || 'Failed to move file');
                    return;
                  }

                  setSuccess(data.message || 'File moved successfully');
                  fetchFileStructure(); // Refresh the file structure
                } catch (error) {
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