import React, { useState, useEffect, useContext } from 'react';
import { TelegramContext } from '../../context/TelegramContext';
import { FaTelegram, FaSearch, FaArrowLeft, FaCheck } from 'react-icons/fa';
import './ChatGroupSelector.css';

const ChatGroupSelector = ({ onBack }) => {
  // States for group selection
  const [groups, setGroups] = useState([]);
  const [filteredGroups, setFilteredGroups] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  
  // Access the Telegram context
  const { 
    telegramClient, 
    setSelectedChatId,
    selectedChatId,
    availableChats,
    setAvailableChats
  } = useContext(TelegramContext);

  // Fetch available chats when component mounts
  useEffect(() => {
    const fetchChats = async () => {
      if (!telegramClient) {
        setError('Telegram client not initialized');
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        // Check if we already have chats in context
        if (availableChats && availableChats.length > 0) {
          setGroups(availableChats);
          setFilteredGroups(availableChats);
          setIsLoading(false);
          return;
        }

        // Fetch chats from Telegram
        const result = await telegramClient.send({
          "@type": "getChats",
          "limit": 100
        });

        if (result && result.chat_ids) {
          // Fetch details for each chat
          const chatDetails = await Promise.all(
            result.chat_ids.map(async (chatId) => {
              try {
                const chatInfo = await telegramClient.send({
                  "@type": "getChat",
                  "chat_id": chatId
                });
                return chatInfo;
              } catch (error) {
                console.error(`Error fetching details for chat ${chatId}:`, error);
                return null;
              }
            })
          );

          // Filter out null results and non-group chats
          const validGroups = chatDetails.filter(chat => 
            chat && 
            (chat.type['@type'] === 'chatTypeSupergroup' || 
             chat.type['@type'] === 'chatTypeBasicGroup')
          );

          setGroups(validGroups);
          setFilteredGroups(validGroups);
          setAvailableChats(validGroups); // Save to context for future use
        } else {
          setError('No chats found');
        }
      } catch (error) {
        console.error('Error fetching chats:', error);
        setError(error.message || 'Failed to fetch chats');
      } finally {
        setIsLoading(false);
      }
    };

    fetchChats();
  }, [telegramClient, setAvailableChats, availableChats]);

  // Handle search input change
  const handleSearchChange = (e) => {
    const query = e.target.value.toLowerCase();
    setSearchQuery(query);
    
    if (!query.trim()) {
      setFilteredGroups(groups);
      return;
    }
    
    const filtered = groups.filter(group => 
      group.title.toLowerCase().includes(query)
    );
    setFilteredGroups(filtered);
  };

  // Handle group selection
  const handleGroupSelect = (group) => {
    setSelectedGroup(group);
    setSelectedChatId(group.id, group.title);
  };

  // Render loading state
  const renderLoading = () => (
    <div className="group-selector-loading">
      <div className="loading-spinner"></div>
      <p>Loading available groups...</p>
    </div>
  );

  // Render error state
  const renderError = () => (
    <div className="group-selector-error">
      <p>{error}</p>
      <button onClick={() => window.location.reload()} className="retry-button">
        Retry
      </button>
    </div>
  );

  // Render empty state
  const renderEmpty = () => (
    <div className="group-selector-empty">
      <p>No groups found. Please create a group in Telegram first.</p>
    </div>
  );

  // Render group list
  const renderGroupList = () => (
    <div className="group-list">
      {filteredGroups.length === 0 ? (
        <div className="no-results">No groups match your search</div>
      ) : (
        filteredGroups.map(group => (
          <div 
            key={group.id} 
            className={`group-item ${selectedGroup && selectedGroup.id === group.id ? 'selected' : ''}`}
            onClick={() => handleGroupSelect(group)}
          >
            <div className="group-avatar">
              {group.title.charAt(0).toUpperCase()}
            </div>
            <div className="group-info">
              <div className="group-title">{group.title}</div>
              <div className="group-type">
                {group.type['@type'] === 'chatTypeSupergroup' ? 'Supergroup' : 'Group'}
              </div>
            </div>
            {selectedGroup && selectedGroup.id === group.id && (
              <div className="group-selected">
                <FaCheck />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="chat-group-selector">
      <div className="group-selector-header">
        {onBack && (
          <button className="back-button" onClick={onBack}>
            <FaArrowLeft />
          </button>
        )}
        <div className="header-icon">
          <FaTelegram />
        </div>
        <h2>Select a Group</h2>
      </div>
      
      <div className="group-selector-content">
        <p className="instruction-text">
          Select a Telegram group where your files will be stored.
        </p>
        
        <div className="search-container">
          <FaSearch className="search-icon" />
          <input
            type="text"
            value={searchQuery}
            onChange={handleSearchChange}
            placeholder="Search groups..."
            className="search-input"
          />
        </div>
        
        {isLoading ? renderLoading() : 
         error ? renderError() : 
         groups.length === 0 ? renderEmpty() : 
         renderGroupList()}
      </div>
      
      {selectedGroup && (
        <div className="group-selector-footer">
          <button 
            className="continue-button"
            onClick={() => {
              // The setSelectedChatId function already saves to localStorage
              // Just confirm the selection here
              console.log(`Group selected: ${selectedGroup.title} (${selectedGroup.id})`);
            }}
          >
            Continue with {selectedGroup.title}
          </button>
        </div>
      )}
    </div>
  );
};

export default ChatGroupSelector;