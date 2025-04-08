import React, { useState, useEffect, useContext } from 'react';
import { TelegramContext } from '../../context/TelegramContext';
import { FaUsers, FaSignOutAlt, FaSyncAlt, FaSearch, FaCheck, FaToggleOn, FaToggleOff } from 'react-icons/fa';
import './ChatGroupSelector.css';
import gramSafeLogo from './GramSafeLogo.svg';

const ChatGroupSelector = () => {
  const [chatGroups, setChatGroups] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const { 
    telegramClient, 
    isConnected, 
    selectedChatId,
    selectedChatName,
    setSelectedChatId,
    logout,
    isDryModeEnabled,
    setIsDryModeEnabled
  } = useContext(TelegramContext);

  // Fetch available chat groups when connected and no group is selected
  useEffect(() => {
    if (isConnected && telegramClient && !selectedChatId) {
      fetchChatGroups();
    }
  }, [isConnected, telegramClient, selectedChatId]);

  const fetchChatGroups = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      // Fetch chats from Telegram
      const result = await telegramClient.send({
        '@type': 'getChats',
        'limit': 100 // Limit to 100 chats for performance
      });
      
      if (result && result.chat_ids && result.chat_ids.length > 0) {
        // Fetch details for each chat
        const chatDetails = await Promise.all(
          result.chat_ids.map(async (chatId) => {
            try {
              const chatInfo = await telegramClient.send({
                '@type': 'getChat',
                'chat_id': chatId
              });
              
              return {
                id: chatId,
                title: chatInfo.title || `Chat ${chatId}`,
                type: chatInfo.type['@type'] || 'unknown'
              };
            } catch (error) {
              console.error(`Error fetching details for chat ${chatId}:`, error);
              return null;
            }
          })
        );
        
        // Filter out null values and sort by title
        const validChats = chatDetails
          .filter(chat => chat !== null)
          .sort((a, b) => a.title.localeCompare(b.title));
        
        setChatGroups(validChats);
      } else {
        setChatGroups([]);
        setError('No chat groups found');
      }
    } catch (error) {
      console.error('Error fetching chat groups:', error);
      setError(`Failed to fetch chat groups: ${error.message || 'Unknown error'}`);
      setChatGroups([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChatSelect = (chatId, chatName) => {
    setSelectedChatId(chatId, chatName);
  };

  const handleLogout = () => {
    logout();
  };

  const handleRefresh = () => {
    fetchChatGroups();
  };

  const handleDryModeToggle = () => {
    setIsDryModeEnabled(!isDryModeEnabled);
  };

  return (
    <div className="chat-group-selector">
      <div className="selector-header">
        <h3>
          {selectedChatId && selectedChatName ? (
            <>
              <FaUsers style={{ marginRight: '8px' }} /> Selected Group
            </>
          ) : (
            <>
              <FaUsers style={{ marginRight: '8px' }} /> Select Chat Group
            </>
          )}
        </h3>
        <div className="selector-actions">
          {!selectedChatId && (
            <button 
              className="refresh-button" 
              onClick={handleRefresh} 
              disabled={!isConnected || isLoading}
              title="Refresh chat list"
            >
              <FaSyncAlt /> Refresh
            </button>
          )}
          <button 
            className="logout-button" 
            onClick={handleLogout}
            title="Logout"
          >
            <FaSignOutAlt /> Logout
          </button>
        </div>
      </div>
      
      {!selectedChatId && !isLoading && !error && chatGroups.length > 0 && (
        <div className="search-container">
          <FaSearch style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#6c757d' }} />
          <input
            type="text"
            className="search-input"
            placeholder="Search chat groups..."
            onChange={(e) => {
              const query = e.target.value.toLowerCase();
              const filtered = chatGroups.filter(chat => 
                chat.title.toLowerCase().includes(query)
              );
              setChatGroups(filtered.length > 0 ? filtered : chatGroups);
            }}
          />
        </div>
      )}
      
      {selectedChatId && selectedChatName ? (
        <div className="selected-chat-info">
          <FaCheck style={{ fontSize: '20px', color: '#0088cc', marginBottom: '8px' }} />
          <p>Group has been selected: <strong>{selectedChatName}</strong></p>
          <p className="help-text">You can change the group after logging out and logging back in.</p>
          <div className="dry-mode-toggle">
            <button 
              className={`toggle-button ${isDryModeEnabled ? 'active' : ''}`}
              onClick={handleDryModeToggle}
              title={isDryModeEnabled ? "Dry Mode Enabled - Files are only removed from metadata" : "Dry Mode Disabled - Files will be actually deleted"}
            >
              {isDryModeEnabled ? <FaToggleOn /> : <FaToggleOff />}
              <span>Dry Mode {isDryModeEnabled ? 'Enabled' : 'Disabled'}</span>
            </button>
            <p className="dry-mode-description">
              {isDryModeEnabled ? 
                "When enabled, files are only removed from metadata but not actually deleted from Telegram." : 
                "When disabled, files will be permanently deleted from Telegram."}
            </p>
          </div>
        </div>
      ) : isLoading ? (
        <div className="loading-message">
          <div className="loading-spinner"></div>
          <p>Loading chat groups...</p>
        </div>
      ) : error ? (
        <div className="error-message">
          <p>{error}</p>
          <button className="refresh-button" onClick={handleRefresh}>
            <FaSyncAlt /> Try Again
          </button>
        </div>
      ) : chatGroups.length === 0 ? (
        <div className="empty-message">
          <FaUsers style={{ fontSize: '28px', opacity: '0.6' }} />
          <p>No chat groups available</p>
          <button className="refresh-button" onClick={handleRefresh}>
            <FaSyncAlt /> Try Again
          </button>
        </div>
      ) : (
        <ul className="chat-list">
          {chatGroups.map((chat) => (
            <li 
              key={chat.id} 
              className={`chat-item ${selectedChatId === chat.id ? 'selected' : ''}`}
              onClick={() => handleChatSelect(chat.id, chat.title)}
            >
              <div className="chat-item-content">
                <div className="chat-avatar">
                  {chat.title.charAt(0).toUpperCase()}
                </div>
                <span className="chat-title">{chat.title}</span>
              </div>
              <div className="chat-item-right">
                <span className="chat-type">{chat.type.replace('chatType', '')}</span>
                {selectedChatId === chat.id && <FaCheck className="check-icon" />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default ChatGroupSelector;