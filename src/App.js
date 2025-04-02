import React, { useEffect } from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer/FileExplorer';
import TelegramMessenger from './components/TelegramMessenger/TelegramMessenger';
import { TelegramProvider, useTelegram } from './context/TelegramContext';

// Component to handle app-level effects
const AppContent = () => {
  const { clearDownloadedFiles } = useTelegram();
  
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
  
  return (
    <div className="app-container">
      <FileExplorer />
      <TelegramMessenger />
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
