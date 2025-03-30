import React from 'react';
import './App.css';
import FileExplorer from './components/FileExplorer/FileExplorer';
import TelegramMessenger from './components/TelegramMessenger/TelegramMessenger';

function App() {
  return (
    <div className="App">
      <div className="app-container">
        <FileExplorer />
        <TelegramMessenger />
      </div>
    </div>
  );
}

export default App;
