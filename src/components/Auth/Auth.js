import React, { useState, useEffect, useContext } from 'react';
import { TelegramContext } from '../../context/TelegramContext';
import LoginPage from './LoginPage';
import GroupSelector from './GroupSelector';
import './Auth.css';

const Auth = () => {
  // Authentication flow states
  const [authStep, setAuthStep] = useState('login'); // 'login', 'group', 'complete'
  
  // Access the Telegram context
  const { 
    isConnected,
    selectedChatId,
    selectedChatName
  } = useContext(TelegramContext);

  // Update auth step based on connection and chat selection status
  useEffect(() => {
    if (!isConnected) {
      setAuthStep('login');
    } else if (isConnected && !selectedChatId) {
      setAuthStep('group');
    } else if (isConnected && selectedChatId) {
      setAuthStep('complete');
    }
  }, [isConnected, selectedChatId]);

  // Handle back button click in group selector
  const handleBackToLogin = () => {
    setAuthStep('login');
  };

  // Render the appropriate component based on the current auth step
  if (authStep === 'login') {
    return <LoginPage />;
  } else if (authStep === 'group') {
    return <GroupSelector onBack={handleBackToLogin} />;
  } else {
    // Auth is complete, this component won't be rendered
    // as the parent component will show the file explorer instead
    return null;
  }
};

export default Auth;