import React, { useEffect } from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer/FileExplorer';
import FileExplorerHeader from './components/FileExplorer/FileExplorerHeader';
import Auth from './components/Auth/Auth';
import TelegramMessenger from './components/TelegramMessenger/TelegramMessenger';
import { TelegramProvider, useTelegram } from './context/TelegramContext';

// Component to handle app-level effects
const AppContent = () => {
  const { 
    clearDownloadedFiles, 
    isConnected, 
    selectedChatId,
    isFileStructureLoaded
  } = useTelegram();
  
  // Set up event listener to clear files on page refresh/close
  useEffect(() => {
    // Clear files on page load
    clearDownloadedFiles();
    
    // Add event listener for page unload
    window.addEventListener('beforeunload', clearDownloadedFiles);
    
    // Cleanup
    return () => {
      window.removeEventListener('beforeunload', clearDownloadedFiles);
    };
  }, [clearDownloadedFiles]);
  
  // Determine what to render based on authentication state
  const isAuthenticated = isConnected && selectedChatId;
  
  // Show the hidden TelegramMessenger component for handling Telegram API interactions
  // This component will be invisible but still functional
  const renderHiddenTelegramMessenger = () => (
    <div style={{ display: 'none' }}>
      <TelegramMessenger />
    </div>
  );
  
  return (
    <div className="app-container">
      {renderHiddenTelegramMessenger()}
      
      {!isAuthenticated ? (
        <Auth />
      ) : (
        <div className="file-explorer-container">
          <FileExplorerHeader />
          <FileExplorer />
        </div>
      )}
    </div>
  );
};

function App() {
  return (
    <div className="App">
      <TelegramProvider>
        <AppContent />
      </TelegramProvider>
    </div>
  );
}

export default App;
