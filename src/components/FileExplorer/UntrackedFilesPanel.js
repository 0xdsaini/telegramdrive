import React, { useState, useEffect, useContext } from 'react';
import { FaFileAlt, FaCheck, FaPlus, FaEye, FaEyeSlash } from 'react-icons/fa';
import { TelegramContext } from '../../context/TelegramContext';
import { findFolderByPath, addFile } from '../../utils/fileStructureUtils';
// Using FileExplorer.css instead of a separate CSS file
import './FileExplorer.css';

const UntrackedFilesPanel = ({ currentPath, onSuccess, onError }) => {
  const [untrackedFiles, setUntrackedFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  
  const { 
    fileStructure, 
    updateFileStructure,
    telegramClient,
    selectedChatId,
    isConnected
  } = useContext(TelegramContext);

  // Function to scan for untracked files in the current path
  const scanForUntrackedFiles = async () => {
    if (!isConnected || !telegramClient) {
      onError('Not connected to Telegram. Please authenticate first.');
      return;
    }
    
    if (!selectedChatId) {
      onError('No chat group selected. Please select a chat group first.');
      return;
    }

    setIsLoading(true);
    try {
      // Get all messages with documents in the selected chat
      const result = await telegramClient.send({
        '@type': 'searchChatMessages',
        'chat_id': selectedChatId,
        'filter': {
          '@type': 'searchMessagesFilterDocument'
        },
        'limit': 100 // Adjust as needed
      });

      if (!result || !result.messages || !Array.isArray(result.messages)) {
        setUntrackedFiles([]);
        setIsLoading(false);
        return;
      }

      // Get all files from the current folder in the metadata
      const currentFolder = findFolderByPath(fileStructure, currentPath);
      const trackedFiles = currentFolder ? currentFolder.files.map(file => file.filename) : [];
      
      // Filter out messages that contain documents not in the metadata
      const untracked = result.messages
        .filter(message => {
          // Check if the message has a document
          if (message.content['@type'] !== 'messageDocument' || !message.content.document) {
            return false;
          }
          
          const filename = message.content.document.file_name;
          // Check if this file is not already tracked in the current path
          return !trackedFiles.includes(filename);
        })
        .map(message => ({
          messageId: message.id,
          filename: message.content.document.file_name,
          size: message.content.document.document.size,
          date: new Date(message.date * 1000).toLocaleString()
        }));

      setUntrackedFiles(untracked);
    } catch (error) {
      console.error('Error scanning for untracked files:', error);
      onError(`Error scanning for untracked files: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle file selection
  const toggleFileSelection = (messageId) => {
    setSelectedFiles(prev => {
      if (prev.includes(messageId)) {
        return prev.filter(id => id !== messageId);
      } else {
        return [...prev, messageId];
      }
    });
  };

  // Add selected files to the metadata
  const addSelectedFilesToMetadata = async () => {
    if (selectedFiles.length === 0) {
      onError('No files selected');
      return;
    }

    try {
      let updatedStructure = { ...fileStructure };
      
      for (const messageId of selectedFiles) {
        const fileInfo = untrackedFiles.find(file => file.messageId === messageId);
        if (fileInfo) {
          updatedStructure = addFile(updatedStructure, currentPath, fileInfo.filename, fileInfo.messageId);
        }
      }
      
      // Update the file structure in Telegram
      const success = await window.updateTelegramFileStructure(updatedStructure);
      
      if (success) {
        onSuccess(`Added ${selectedFiles.length} file(s) to tracking`);
        // Remove added files from the untracked list
        setUntrackedFiles(prev => prev.filter(file => !selectedFiles.includes(file.messageId)));
        setSelectedFiles([]);
      } else {
        onError('Failed to update file structure');
      }
    } catch (error) {
      console.error('Failed to add files to metadata:', error);
      onError(`Failed to add files to metadata: ${error.message}`);
    }
  };

  // Toggle panel visibility
  const togglePanelVisibility = () => {
    setIsPanelVisible(!isPanelVisible);
    if (!isPanelVisible) {
      scanForUntrackedFiles();
    }
  };

  // Refresh the untracked files list when the current path changes
  useEffect(() => {
    if (isPanelVisible) {
      scanForUntrackedFiles();
    }
  }, [currentPath, isPanelVisible]);

  return (
    <div className="untracked-files-container">
      <button 
        className={`toggle-untracked-button ${isPanelVisible ? 'active' : ''}`}
        onClick={togglePanelVisibility}
        title={isPanelVisible ? "Hide untracked files" : "Show untracked files"}
      >
        {isPanelVisible ? <FaEyeSlash /> : <FaEye />}
        <span>Untracked Files</span>
      </button>
      
      {isPanelVisible && (
        <div className="untracked-files-panel">
          <div className="untracked-files-header">
            <h3>Untracked Files</h3>
            <div className="untracked-actions">
              <button 
                className="untracked-files-refresh-button" 
                onClick={scanForUntrackedFiles}
                disabled={isLoading}
                title="Refresh untracked files list"
              >
                Refresh
              </button>
              <button 
                className="add-selected-button" 
                onClick={addSelectedFilesToMetadata}
                disabled={selectedFiles.length === 0 || isLoading}
                title="Add selected files to tracking"
              >
                <FaPlus /><span>Add</span><span className="untracked-files-add-selection-text-selected">Selected</span>
                <span className="untracked-files-add-selection-count">
                ({selectedFiles.length})</span>
              </button>
            </div>
          </div>
          
          <div className="untracked-files-list">
            {isLoading ? (
              <div className="loading-indicator">Scanning for untracked files...</div>
            ) : untrackedFiles.length === 0 ? (
              <div className="no-files-message">No untracked files found in this location</div>
            ) : (
              untrackedFiles.map(file => (
                <div 
                  key={file.messageId} 
                  className={`untracked-file-item ${selectedFiles.includes(file.messageId) ? 'selected' : ''}`}
                  onClick={() => toggleFileSelection(file.messageId)}
                >
                  <div className="file-icon-container">
                    <FaFileAlt className="file-icon" />
                    {selectedFiles.includes(file.messageId) && (
                      <FaCheck className="selected-icon" />
                    )}
                  </div>
                  <div className="file-details">
                    <span className="file-name">{file.filename}</span>
                    <span className="file-info">{(file.size / 1024).toFixed(2)} KB • {file.date}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default UntrackedFilesPanel;