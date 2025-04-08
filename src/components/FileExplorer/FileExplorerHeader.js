import React, { useContext } from 'react';
import { TelegramContext } from '../../context/TelegramContext';
import { FaSignOutAlt, FaFolder, FaCloud, FaToggleOn, FaToggleOff } from 'react-icons/fa';
import './FileExplorerHeader.css';

const FileExplorerHeader = () => {
  const { 
    selectedChatName,
    logout,
    isDryModeEnabled
  } = useContext(TelegramContext);

  const handleLogout = () => {
    if (window.confirm('Are you sure you want to log out? This will clear all downloaded files.')) {
      logout();
    }
  };

  return (
    <div className="file-explorer-header">
      <div className="header-left">
        <div className="app-logo">
          <FaCloud />
        </div>
        <div className="group-indicator">
          <FaFolder className="folder-icon" />
          <span className="group-name">{selectedChatName || 'No group selected'}</span>
        </div>
        <button 
          className="dry-mode-button" 
          title={isDryModeEnabled ? "Dry Mode Enabled - Files are only removed from metadata" : "Dry Mode Disabled - Files will be actually deleted"}
          disabled
        >
          {isDryModeEnabled ? 
            <FaToggleOn className="dry-mode-icon enabled" /> : 
            <FaToggleOff className="dry-mode-icon disabled" />}
          <span className="dry-mode-text">Dry Mode</span>
        </button>
      </div>
      <div className="header-right">
        <button 
          className="logout-button" 
          onClick={handleLogout}
          title="Logout"
        >
          <FaSignOutAlt className="logout-icon" />
          <span className="logout-text">Logout</span>
        </button>
      </div>
    </div>
  );
};

export default FileExplorerHeader;