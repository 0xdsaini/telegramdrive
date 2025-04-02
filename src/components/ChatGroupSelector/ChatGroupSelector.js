import React, { useState, useEffect, useContext } from 'react';
import { TelegramContext } from '../../context/TelegramContext';
import './ChatGroupSelector.css';

const ChatGroupSelector = () => {
  const [chatGroups, setChatGroups] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  const { 
    telegramClient, 
    isConnected, 
    selectedChatId,
    setSelectedChatId,
    logout
  } = useContext(TelegramContext);

  // Fetch available chat groups when connected
  useEffect(() => {
    if (isConnected && telegramClient) {
      fetchChatGroups();
    }
  }, [isConnected, telegramClient]);

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

  const handleChatSelect = (chatId) => {
    setSelectedChatId(chatId);
  };

  const handleLogout = () => {
    logout();
  };

  const handleRefresh = () => {
    fetchChatGroups();
  };

  return (
    <div className="chat-group-selector">
      <div className="selector-header">
        <h3>Select Chat Group</h3>
        <div className="selector-actions">
          <button 
            className="refresh-button" 
            onClick={handleRefresh} 
            disabled={!isConnected || isLoading}
            title="Refresh chat list"
          >
            ↻
          </button>
          <button 
            className="logout-button" 
            onClick={handleLogout}
            title="Logout"
          >
            Logout
          </button>
        </div>
      </div>
      
      {isLoading ? (
        <div className="loading-message">Loading chat groups...</div>
      ) : error ? (
        <div className="error-message">{error}</div>
      ) : chatGroups.length === 0 ? (
        <div className="empty-message">No chat groups available</div>
      ) : (
        <ul className="chat-list">
          {chatGroups.map((chat) => (
            <li 
              key={chat.id} 
              className={`chat-item ${selectedChatId === chat.id ? 'selected' : ''}`}
              onClick={() => handleChatSelect(chat.id)}
            >
              <span className="chat-title">{chat.title}</span>
              <span className="chat-type">{chat.type.replace('chatType', '')}</span>
            </li>
          ))}
        </ul>
      )}
      
      {selectedChatId && (
        <div className="selected-chat-info">
          <p>Selected: {chatGroups.find(c => c.id === selectedChatId)?.title || selectedChatId}</p>
        </div>
      )}
    </div>
  );
};

export default ChatGroupSelector;