import React, { createContext, useState, useEffect, useContext } from 'react';
import { createEmptyFileStructure } from '../utils/fileStructureUtils';

// Constants for localStorage keys
const SELECTED_CHAT_KEY = 'telegram-selected-chat';
const SELECTED_CHAT_NAME_KEY = 'telegram-selected-chat-name';
const TELEGRAM_DRY_MODE_KEY = 'telegram-dry-mode';

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
  const [selectedChatId, setSelectedChatId] = useState(() => {
    // Try to load the selected chat ID from localStorage
    const savedChatId = localStorage.getItem(SELECTED_CHAT_KEY);
    return savedChatId ? parseInt(savedChatId, 10) : null;
  });
  const [selectedChatName, setSelectedChatName] = useState(() => {
    // Try to load the selected chat name from localStorage
    return localStorage.getItem(SELECTED_CHAT_NAME_KEY) || null;
  });
  const [availableChats, setAvailableChats] = useState([]);
  
  // Dry Mode state - enabled by default
  const [isDryModeEnabled, setIsDryModeEnabled] = useState(() => {
    // Try to load the dry mode state from localStorage
    const savedDryModeState = localStorage.getItem(TELEGRAM_DRY_MODE_KEY);

    // saveDryModeState will be a string at first so "true" and "false" will lead to true and thus
    if (!savedDryModeState) {
      console.log("Dry mode state not found, defaulting to true")
      localStorage.setItem(TELEGRAM_DRY_MODE_KEY, "true");
      return true; // Default to dry mode on first run if nothing is saved
    } else if (savedDryModeState === "true" || savedDryModeState === "false") {
      console.log("Found dry mode state: ", savedDryModeState)
      // returning of JSON.parse(..) will give a boolean(true or false) based on those strings either "true " or "false."
      return JSON.parse(savedDryModeState);      
    } else { // If other than "true", "false" i.e. garbage value stored in that, resort to dry_mode = true.
      console.log("Dry mode contains garbage value(defaulting to true): ", savedDryModeState)
      return true;
    }
  });

  const saveDryModeState = (newState) => {
    console.log("Saving dry mode state: ", newState);
    localStorage.setItem(TELEGRAM_DRY_MODE_KEY, newState.toString());
    setIsDryModeEnabled(newState);
  };
  
  // Function to update file structure
  const updateFileStructure = async (newStructure) => {
    setFileStructure(newStructure);
    // The actual saving to Telegram will be handled by the TelegramMessenger component
    // This just updates the local state
    return true;
  };
  
  // Function to save selected chat to localStorage
  const saveSelectedChat = (chatId, chatName) => {
    if (chatId && chatName) {
      localStorage.setItem(SELECTED_CHAT_KEY, chatId.toString());
      localStorage.setItem(SELECTED_CHAT_NAME_KEY, chatName);
      console.log(`Saved selected chat: ${chatName} (${chatId}) to localStorage`);
    }
  };

  // Custom setter for selectedChatId that also updates localStorage
  const updateSelectedChatId = (chatId, chatName) => {
    setSelectedChatId(chatId);
    if (chatName) {
      setSelectedChatName(chatName);
    }
    saveSelectedChat(chatId, chatName);
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
      setSelectedChatName(null);
      setAvailableChats([]);
      
      // Clear selected chat from localStorage
      localStorage.removeItem(SELECTED_CHAT_KEY);
      localStorage.removeItem(SELECTED_CHAT_NAME_KEY);
      // Clear message ID from localStorage
      localStorage.removeItem('telegram-metadata-message-id'); //NOTICE: This is problematic. hardcoding should not be there.
      
      // delete all files from the file system
      deleteAllDatabases();
      // Clear any downloaded files from storage
      // clearDownloadedFiles();
      console.log('Logged out successfully');
    } catch (error) {
      console.error('Error during logout:', error);
    }
  };
  const deleteAllDatabases = () => {
    if (window.indexedDB) {
      try {
        const dbNames = ['/tdlib', '/tdlib/dbfs',
                         'tdlib', 'tdlib/dbfs', // These ones gets created sometimes, making sure we delete them also.
        ]; // These are the two crucial databases that TDLib uses as we've defined in setTdlibparameters somewhere at start. NOTICE though: hardcoding is made here.

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
        console.error('Error deleting databases:', error);
      }
    }
  }
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
    setSelectedChatId: updateSelectedChatId,
    selectedChatName,
    setSelectedChatName,
    availableChats,
    setAvailableChats,
    isDryModeEnabled,
    setIsDryModeEnabled: saveDryModeState,
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