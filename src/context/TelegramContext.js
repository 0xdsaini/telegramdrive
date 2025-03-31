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
  
  // Function to update file structure
  const updateFileStructure = async (newStructure) => {
    setFileStructure(newStructure);
    // The actual saving to Telegram will be handled by the TelegramMessenger component
    // This just updates the local state
    return true;
  };

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
    updateFileStructure
  };

  return (
    <TelegramContext.Provider value={contextValue}>
      {children}
    </TelegramContext.Provider>
  );
};

// Custom hook for using the Telegram context
export const useTelegram = () => useContext(TelegramContext);