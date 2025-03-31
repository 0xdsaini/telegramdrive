import React from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer/FileExplorer';
import TelegramMessenger from './components/TelegramMessenger/TelegramMessenger';
import { TelegramProvider } from './context/TelegramContext';

function App() {
  return (
    <div className="App">
      <TelegramProvider>
        <div className="app-container">
          <FileExplorer />
          <TelegramMessenger />
        </div>
      </TelegramProvider>
    </div>
  );
}

export default App;
