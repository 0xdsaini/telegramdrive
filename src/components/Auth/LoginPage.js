import React, { useState, useEffect, useContext } from 'react';
import { TelegramContext } from '../../context/TelegramContext';
import './Auth.css';
import { FaTelegram, FaLock, FaPhone, FaArrowRight } from 'react-icons/fa';

const LoginPage = () => {
  // States for authentication
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [authStep, setAuthStep] = useState('phone'); // 'phone', 'code', or 'complete'
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Access the Telegram context
  const { 
    telegramClient, 
    isConnected,
    setIsConnected
  } = useContext(TelegramContext);

  // Handle phone number input change
  const handlePhoneNumberChange = (e) => {
    setPhoneNumber(e.target.value);
  };
  
  // Handle verification code input change
  const handleVerificationCodeChange = (e) => {
    const code = e.target.value;
    setVerificationCode(code);
    
    // Auto-submit when code reaches 5 digits (required OTP length)
    if (code.length === 6 && !isLoading) {
      // Use a small timeout to ensure state is updated
      setTimeout(() => {
        handleVerificationCodeSubmit({ preventDefault: () => {} });
      }, 100);
    }
  };
  
  // Handle phone number submission
  const handlePhoneNumberSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    
    try {
      if (!telegramClient) {
        throw new Error('Telegram client not initialized');
      }
      
      // Format phone number
      const formattedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
      
      // Send phone number to Telegram
      await telegramClient.send({
        '@type': 'setAuthenticationPhoneNumber',
        'phone_number': formattedPhone,
        'settings': {
          '@type': 'phoneNumberAuthenticationSettings',
          'allow_flash_call': false,
          'allow_missed_call': false,
          'is_current_phone_number': true,
          'allow_sms_retriever_api': false
        }
      });
      
      // Move to verification code step
      setAuthStep('code');
    } catch (error) {
      console.error('Error sending phone number:', error);
      setError(error.message || 'Failed to send phone number');
    } finally {
      setIsLoading(false);
    }
  };
  
  // Handle verification code submission
  const handleVerificationCodeSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    
    try {
      if (!telegramClient) {
        throw new Error('Telegram client not initialized');
      }
      
      // Add a small delay before sending the code to ensure Telegram's servers are ready
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Send verification code to Telegram
      await telegramClient.send({
        '@type': 'checkAuthenticationCode',
        'code': verificationCode
      });
      
      // Authentication should be complete at this point
      // The TelegramContext will handle the state change via the updateAuthorizationState event
      setAuthStep('complete');
    } catch (error) {
      console.error('Error sending verification code:', error);
      setError(error.message || 'Failed to verify code');
    } finally {
      setIsLoading(false);
    }
  };

  // Update auth step when connection status changes
  useEffect(() => {
    if (isConnected) {
      setAuthStep('complete');
    }
  }, [isConnected]);

  // Render phone number input form
  const renderPhoneNumberForm = () => (
    <div className="auth-card">
      <div className="auth-header">
        <div className="auth-logo">
          <FaTelegram />
        </div>
        <h2>Connect to Telegram</h2>
        <p>Enter your phone number to get started</p>
      </div>
      
      <form onSubmit={handlePhoneNumberSubmit}>
        <div className="input-group">
          <FaPhone className="input-icon" />
          <input
            type="tel"
            value={phoneNumber}
            onChange={handlePhoneNumberChange}
            placeholder="+1 234 567 8900"
            required
            autoFocus
          />
        </div>
        
        <button 
          type="submit" 
          className="auth-button"
          disabled={!phoneNumber.trim() || isLoading}
        >
          {isLoading ? 'Sending...' : 'Continue'}
          {!isLoading && <FaArrowRight className="button-icon" />}
        </button>
      </form>
      
      {error && <div className="auth-error">{error}</div>}
    </div>
  );
  
  // Render verification code input form
  const renderVerificationCodeForm = () => (
    <div className="auth-card">
      <div className="auth-header">
        <div className="auth-logo">
          <FaLock />
        </div>
        <h2>Verification Code</h2>
        <p>Enter the code sent to your phone</p>
      </div>
      
      <form onSubmit={handleVerificationCodeSubmit}>
        <div className="input-group">
          <input
            type="text"
            value={verificationCode}
            onChange={handleVerificationCodeChange}
            placeholder="Enter code"
            required
            autoFocus
          />
        </div>
        
        <button 
          type="submit" 
          className="auth-button"
          disabled={!verificationCode.trim() || isLoading}
        >
          {isLoading ? 'Verifying...' : 'Verify'}
          {!isLoading && <FaArrowRight className="button-icon" />}
        </button>
      </form>
      
      {error && <div className="auth-error">{error}</div>}
    </div>
  );
  
  // Render loading state
  const renderLoading = () => (
    <div className="auth-card">
      <div className="auth-header">
        <div className="auth-logo loading">
          <FaTelegram />
        </div>
        <h2>Connecting...</h2>
        <p>Please wait while we connect to Telegram</p>
      </div>
      <div className="loading-spinner"></div>
    </div>
  );

  // Render the appropriate form based on the current auth step
  return (
    <div className="login-page">
      {authStep === 'phone' && renderPhoneNumberForm()}
      {authStep === 'code' && renderVerificationCodeForm()}
      {authStep === 'complete' && renderLoading()}
    </div>
  );
};

export default LoginPage;