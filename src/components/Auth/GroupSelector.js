import React, { useState, useEffect, useContext } from 'react';
import { TelegramContext } from '../../context/TelegramContext';
import { FaUsers, FaSearch, FaArrowLeft, FaCheck } from 'react-icons/fa';
import './Auth.css';

const GroupSelector = ({ onBack }) => {
  const [chatGroups, setChatGroups] = useState([]);
  const [filteredGroups, setFilteredGroups] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  
  const { 
    telegramClient, 
    isConnected,
    setSelectedChatId
  } = useContext(TelegramContext);

  // Fetch available chat groups when component mounts
  useEffect(() => {
    if (isConnected && telegramClient) {
      fetchChatGroups();
    }
  }, [isConnected, telegramClient]);

  // Filter groups when search query changes
  useEffect(() => {
    if (searchQuery.trim() === '') {
      setFilteredGroups(chatGroups);
    } else {
      const query = searchQuery.toLowerCase();
      const filtered = chatGroups.filter(group => 
        group.title.toLowerCase().includes(query)
      );
      setFilteredGroups(filtered);
    }
  }, [searchQuery, chatGroups]);

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
              
              // Only include groups and supergroups
              const type = chatInfo.type['@type'];
              if (type === 'chatTypeBasicGroup' || type === 'chatTypeSupergroup') {
                return {
                  id: chatId,
                  title: chatInfo.title || `Chat ${chatId}`,
                  type: type,
                  memberCount: chatInfo.member_count || 0,
                  photo: chatInfo.photo ? chatInfo.photo.small : null
                };
              }
              return null;
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
        setFilteredGroups(validChats);
      } else {
        setChatGroups([]);
        setFilteredGroups([]);
        setError('No chat groups found');
      }
    } catch (error) {
      console.error('Error fetching chat groups:', error);
      setError(`Failed to fetch chat groups: ${error.message || 'Unknown error'}`);
      setChatGroups([]);
      setFilteredGroups([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleChatSelect = (chatId, chatName) => {
    setSelectedChatId(chatId, chatName);
  };

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
  };

  const handleRefresh = () => {
    fetchChatGroups();
  };

  return (
    <div className="group-selector-container">
      <div className="group-selector-header">
        <button className="back-button" onClick={onBack}>
          <FaArrowLeft />
        </button>
        <h2>Select a Group</h2>
      </div>
      
      <div className="search-container">
        <FaSearch className="search-icon" />
        <input
          type="text"
          placeholder="Search groups..."
          value={searchQuery}
          onChange={handleSearchChange}
          className="search-input"
        />
      </div>
      
      <div className="groups-container">
        {isLoading ? (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p>Loading groups...</p>
          </div>
        ) : error ? (
          <div className="error-container">
            <p>{error}</p>
            <button className="refresh-button" onClick={handleRefresh}>
              Try Again
            </button>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="empty-container">
            <FaUsers className="empty-icon" />
            <p>{searchQuery ? 'No matching groups found' : 'No groups available'}</p>
            {searchQuery && (
              <button className="clear-search" onClick={() => setSearchQuery('')}>
                Clear Search
              </button>
            )}
          </div>
        ) : (
          <ul className="group-list">
            {filteredGroups.map((group) => (
              <li 
                key={group.id} 
                className="group-item"
                onClick={() => handleChatSelect(group.id, group.title)}
              >
                <div className="group-avatar">
                  {group.title.charAt(0).toUpperCase()}
                </div>
                <div className="group-info">
                  <span className="group-title">{group.title}</span>
                  <span className="group-type">
                    {group.type === 'chatTypeBasicGroup' ? 'Group' : 'Supergroup'}
                  </span>
                </div>
                <FaCheck className="select-icon" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default GroupSelector;