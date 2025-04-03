import React, { useContext } from 'react';
import { TelegramContext } from '../../context/TelegramContext';
import { FaSignOutAlt, FaFolder, FaCloud } from 'react-icons/fa';
import './FileExplorerHeader.css';

const FileExplorerHeader = () => {
  const { 
    selectedChatName,
    logout
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