import React, { createContext, useState, useEffect, useContext } from 'react';
import { createEmptyFileStructure } from '../utils/fileStructureUtils';

// Create the context
export const TelegramContext = createContext();

/**
 * Provider component for Telegram-related functionality
 * This context provides access to the Telegram client and file structure
 */
export const TelegramProvider = ({ children }) => {
  // File structure state
  const [fileStructure, setFileStructure] = useState(createEmptyFileStructure());
  const [isFileStructureLoaded, setIsFileStructureLoaded] = useState(false);
  
  // Reference to the Telegram client
  const [telegramClient, setTelegramClient] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [messageId, setMessageId] = useState(null);
  
  // Chat selection state
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [availableChats, setAvailableChats] = useState([]);
  
  // Function to update file structure
  const updateFileStructure = async (newStructure) => {
    setFileStructure(newStructure);
    // The actual saving to Telegram will be handled by the TelegramMessenger component
    // This just updates the local state
    return true;
  };
  
  // Function to handle logout
  const logout = async () => {
    try {
      if (telegramClient) {
        await telegramClient.send({
          '@type': 'logOut'
        });
      }
      
      // Reset all state
      setFileStructure(createEmptyFileStructure());
      setIsFileStructureLoaded(false);
      setIsConnected(false);
      setMessageId(null);
      setSelectedChatId(null);
      setAvailableChats([]);
      
      // Clear any downloaded files from storage
      clearDownloadedFiles();
      
      console.log('Logged out successfully');
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };
  
  // Function to clear downloaded files
  const clearDownloadedFiles = () => {
    // Clear IndexedDB storage
    if (window.indexedDB) {
      try {
        // List of database names that might be used by TDLib or our app
        const dbNames = ['tdlib-files', 'file-storage', 'telegram-files'];
        
        dbNames.forEach(dbName => {
          const request = window.indexedDB.deleteDatabase(dbName);
          
          request.onsuccess = () => {
            console.log(`Database ${dbName} successfully deleted`);
          };
          
          request.onerror = () => {
            console.error(`Error deleting database ${dbName}`);
          };
        });
      } catch (error) {
        console.error('Error clearing IndexedDB storage:', error);
      }
    }
    
    // Clear localStorage and sessionStorage
    try {
      localStorage.removeItem('telegram-file-cache');
      sessionStorage.removeItem('telegram-file-cache');
    } catch (error) {
      console.error('Error clearing web storage:', error);
    }
  };
  
  // Clear downloaded files when the page is refreshed or closed
  useEffect(() => {
    const handleBeforeUnload = () => {
      clearDownloadedFiles();
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  // Context value
  const contextValue = {
    fileStructure,
    setFileStructure,
    isFileStructureLoaded,
    setIsFileStructureLoaded,
    telegramClient,
    setTelegramClient,
    isConnected,
    setIsConnected,
    messageId,
    setMessageId,
    updateFileStructure,
    selectedChatId,
    setSelectedChatId,
    availableChats,
    setAvailableChats,
    logout,
    clearDownloadedFiles
  };

  return (
    <TelegramContext.Provider value={contextValue}>
      {children}
    </TelegramContext.Provider>
  );
};

// Custom hook for using the Telegram context
export const useTelegram = () => useContext(TelegramContext);