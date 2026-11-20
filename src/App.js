import React, { useEffect } from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer/FileExplorer';
import FileExplorerHeader from './components/FileExplorer/FileExplorerHeader';
import Auth from './components/Auth/Auth';
import TelegramMessenger from './components/TelegramMessenger/TelegramMessenger';
import { TelegramProvider, useTelegram } from './context/TelegramContext';
import { redirectToAppBaseIfNeeded } from './utils/appBasePath';
import { registerStreamBridge, setStreamBridgeClient, refreshStreamBridgeAfterIdle } from './utils/streamBridge';
import { installStreamDebugHelpers } from './utils/streamDebug';
import { recordAppBoot } from './utils/reloadDebug';
import { ensureTelegramThumbsStore } from './utils/telegramThumbsStore';
import MobileReloadDebugPanel from './components/Debug/MobileReloadDebugPanel';

// Component to handle app-level effects
const AppContent = () => {
  const { 
    clearDownloadedFiles, 
    isConnected, 
    selectedChatId,
    isFileStructureLoaded,
    telegramClient
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

  useEffect(() => {
    redirectToAppBaseIfNeeded();
    recordAppBoot();
    installStreamDebugHelpers();
    registerStreamBridge();
  }, []);

  useEffect(() => {
    setStreamBridgeClient(telegramClient);
  }, [telegramClient]);

  useEffect(() => {
    if (!isConnected || !selectedChatId || !telegramClient || !isFileStructureLoaded) {
      return;
    }
    ensureTelegramThumbsStore(telegramClient, selectedChatId).catch((error) => {
      console.warn('Failed to load or sync thumbs.db:', error);
    });
  }, [isConnected, selectedChatId, telegramClient, isFileStructureLoaded]);

  useEffect(() => {
    const bootAt = Date.now();
    const MIN_MS_BEFORE_WAKE_RECLAIM = 12_000;
    let hiddenAt = null;

    const shouldSkipWakeReclaim = () =>
      Date.now() - bootAt < MIN_MS_BEFORE_WAKE_RECLAIM;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (document.visibilityState === 'visible') {
        if (shouldSkipWakeReclaim() && hiddenAt == null) {
          return;
        }
        const idleMs = hiddenAt != null ? Date.now() - hiddenAt : 0;
        hiddenAt = null;
        refreshStreamBridgeAfterIdle(telegramClient, { idleMs });
      }
    };
    const onWake = () => {
      if (document.visibilityState === 'visible' && !shouldSkipWakeReclaim()) {
        refreshStreamBridgeAfterIdle(telegramClient);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onWake);
    window.addEventListener('pageshow', onWake);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('pageshow', onWake);
    };
  }, [telegramClient]);
  
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
      <MobileReloadDebugPanel />
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
