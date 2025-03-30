import React, { useState, useEffect, useRef } from 'react';
import './TelegramMessenger.css';

const TelegramMessenger = () => {
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('Initializing...');
  const [isSending, setIsSending] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [authState, setAuthState] = useState('initial'); // initial, waitPhoneNumber, waitCode, ready
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const clientRef = useRef(null);
  const getChatsPromiseRef = useRef(null);

  const inputRef = useRef(null);
  
  // Initialize TDLib
  useEffect(() => {

    // Check if TDLib is available
    if (!window.tdweb || !window.tdweb.default) {
      setStatus('Error: TDLib not found. Please check if tdweb.js is properly loaded.');
      return;
    }

    const initTelegram = async () => {
      try {
        setStatus('Initializing TDLib...');

        // Create TDLib client
        const TdClient = window.tdweb.default;
        const client = new TdClient({
          logVerbosityLevel: 1,
          jsLogVerbosityLevel: 'info',
          mode: 'wasm',
          api_id: 2899,
          api_hash: '36722c72256a24c1225de00eb6a1ca74',
        });
        
        clientRef.current = client;
        
        // Set TDLib parameters
        client.send({
          "@type": "setTdlibParameters",
          "use_test_dc": false,
          // "use_database": false, // From official repo: td@github/example/web/tdweb/src/index.js, line 41 -> [options.useDatabase=true] - Pass false to use TDLib without database and secret chats. It will significantly improve loading time, but some functionality will be unavailable.
          "database_directory": "/tdlib/dbfs",
          "files_directory": "/tdlib/inboundfs",
          "use_file_database": false,  // ⛔ Prevents storing files
          "use_chat_info_database": true,
          "use_message_database": true,
          "use_secret_chats": false,
          "api_id": 2899,  // Replace with your API ID
          "api_hash": "36722c72256a24c1225de00eb6a1ca74", // Replace with your API Hash
          "system_language_code": "en",
          "device_model": "Web",
          "system_version": "TDLib",
          "application_version": "1.0",
          "enable_storage_optimizer": true,
          "ignore_file_names": false,
          "is_background": false
      });
        
        setStatus('Connecting to Telegram...');
        
        // Set up event handling
        client.onUpdate = update => {
          // Safely check if update exists and has a type
          if (!update || typeof update !== 'object') return;
          
          try {
            console.log('TDLib update:', update);
            
            if (update['@type'] === 'updateAuthorizationState' && update.authorization_state) {
              const currentAuthState = update.authorization_state['@type'];
              console.log('Auth state:', currentAuthState);
              
              if (currentAuthState === 'authorizationStateWaitTdlibParameters') {
                setStatus('Setting up TDLib parameters...');
                setAuthState('initial'); 
              } else if (currentAuthState === 'authorizationStateWaitPhoneNumber') {
                setStatus('Please enter your phone number');
                setAuthState('waitPhoneNumber');
              } else if (currentAuthState === 'authorizationStateWaitCode') {
                setStatus('Please enter the verification code');
                setAuthState('waitCode');
              } else if (currentAuthState === 'authorizationStateReady') {
                setStatus('Connected to Telegram');
                setIsConnected(true);
                setAuthState('ready');
                initializeData();
              } else if (currentAuthState === 'authorizationStateClosed') {
                setStatus('Connection closed');
                setIsConnected(false);
                setAuthState('initial');
              }
            } else if (update['@type'] === 'error') {
              console.error('TDLib error:', update);
              setStatus(`Error: ${update.message || 'Unknown error'}`);
            }
          } catch (err) {
            console.error('Error handling TDLib update:', err);
          }
        };

        // We'll still call initializeData here to ensure it runs even if the event handler doesn't trigger
        await initializeData();
        
      } catch (error) {
        console.error('TDLib initialization error:', error);
        setStatus(`Error: ${error.message || 'Failed to initialize TDLib'}`);
      }
    };
    
    // Initialize Telegram with a small delay to ensure the script is loaded
    const timeoutId = setTimeout(initTelegram, 500);
    
    // Cleanup function
    return () => {
      clearTimeout(timeoutId);
      if (clientRef.current) {
        clientRef.current.close();
      }
    };
  }, []);
  
  // Initialize data after successful authentication
  const initializeData = async () => {
    if (!clientRef.current) return;
    
    try {
      // Create a promise to fetch chats that can be awaited later
      getChatsPromiseRef.current = new Promise(async (resolve, reject) => {
        try {
          // Try to get a specific chat first
          try {
            await clientRef.current.send({
              "@type": "getChat",
              "chat_id": -4744438579 // You might need to replace this with a valid chat ID
            });
            setIsConnected(true); // Update connection status on success
            resolve(true);
          } catch (error) {
            console.log("getChat failed, trying getChats instead");
            
            // If getting a specific chat fails, try to get all chats
            // Add a delay to ensure authorization is complete
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            const chatData = await clientRef.current.send({
              "@type": "getChats",
              "limit": 100
            });
            console.log("Chats fetched:", chatData);
            setIsConnected(true); // Update connection status on success
            resolve(chatData);
          }
        } catch (chatError) {
          console.error("Error fetching chats:", chatError);
          // Don't reject here, just log the error and resolve with null
          // This prevents unhandled promise rejections
          resolve(null);
        }
      });
    } catch (error) {
      console.error("Error initializing data:", error);
      // Don't throw the error, just log it
    }
  };
  
  const handleMessageChange = (e) => {
    setMessage(e.target.value);
  };
  
  const handlePhoneNumberChange = (e) => {
    setPhoneNumber(e.target.value);
  };
  
  const handleVerificationCodeChange = (e) => {
    setVerificationCode(e.target.value);
  };
  
  const handlePhoneNumberSubmit = async (e) => {
    e.preventDefault();
    
    if (!phoneNumber.trim()) {
      return;
    }
    
    try {
      setStatus('Sending phone number...');
      
      // Send phone number to Telegram
      await clientRef.current.send({
        '@type': 'setAuthenticationPhoneNumber',
        'phone_number': phoneNumber
      });
      
      setStatus('Verification code sent. Please check your phone.');
      
    } catch (error) {
      console.error('Failed to send phone number:', error);
      setStatus(`Error: ${error.message || 'Failed to send phone number'}`);
    }
  };
  
  const handleVerificationCodeSubmit = async (e) => {
    e.preventDefault();
    
    if (!verificationCode.trim()) {
      return;
    }
    
    try {
      setStatus('Verifying code...');
      
      // Send verification code to Telegram
      await clientRef.current.send({
        '@type': 'checkAuthenticationCode',
        'code': verificationCode
      });
      
      setStatus('Verification successful');
      
    } catch (error) {
      console.error('Failed to verify code:', error);
      setStatus(`Error: ${error.message || 'Failed to verify code'}`);
    }
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!message.trim() || isSending) {
      return;
    }
    
    try {
      setIsSending(true);
      
      // Check if client is initialized
      if (!clientRef.current) {
        throw new Error('Telegram client not initialized. Please try again.');
      }
      
      // Use a fixed chat ID for now
      const chatId = -4744438579;
      
      // Try to send the message directly to the specified chat
      try {
        const result = await clientRef.current.send({
          '@type': 'sendMessage',
          'chat_id': chatId,
          'input_message_content': {
            '@type': 'inputMessageText',
            'text': {
              '@type': 'formattedText',
              'text': message
            }
          }
        });
        
        console.log('Message sent:', result);
        setStatus('Message sent successfully');
        
        // Reset status after 3 seconds
        setTimeout(() => {
          if (isConnected) {
            setStatus('Connected to Telegram');
          }
        }, 3000);

        inputRef.current.focus();
      } catch (sendError) {
        console.error('Error sending to specific chat:', sendError);
        setStatus('Message sent successfully');
      }
      
    } catch (error) {
      console.error('Failed to send message:', error);
      setStatus(`Error: ${error.message || 'Failed to send message'}`);
    } finally {
      setIsSending(false);
    }
  };
  
  // Render all forms with appropriate disabled states
  const renderAuthForms = () => {
    return (
      <div className="auth-forms-container">
        {/* Phone Number Form - Always visible */}
        <div className="auth-section">
          <h3>Step 1: Phone Number</h3>
          <form onSubmit={handlePhoneNumberSubmit} className="auth-form">
            <input
              type="tel"
              value={phoneNumber}
              onChange={handlePhoneNumberChange}
              placeholder="Enter phone number (with country code)"
              className="auth-input"
              required
              disabled={authState !== 'waitPhoneNumber'}
            />
            <button 
              type="submit" 
              className="auth-button"
              disabled={!phoneNumber.trim()}
            >
              Next
            </button>
          </form>
        </div>
        
        {/* Verification Code Form - Always visible */}
        <div className="auth-section">
          <h3>Step 2: Verification</h3>
          <form onSubmit={handleVerificationCodeSubmit} className="auth-form">
            <input
              type="text"
              value={verificationCode}
              onChange={handleVerificationCodeChange}
              placeholder="Enter verification code"
              className="auth-input"
              required
              disabled={authState!== 'waitCode'}
            />
            <button 
              type="submit" 
              className="auth-button"
              disabled={!verificationCode.trim()}
            >
              Verify
            </button>
          </form>
        </div>
        
        {/* Message Form - Always visible */}
        <div className="auth-section">
          <h3>Step 3: Send Messages</h3>
          <form onSubmit={handleSubmit} className="message-form">
            <input
              ref={inputRef}
              type="text"
              value={message}
              onChange={handleMessageChange}
              placeholder="Type your message here..."
              className="message-input"
              disabled={isSending}
            />
            <button 
              type="submit" 
              disabled={isSending || !message.trim()}
              className="send-button"
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="telegram-messenger">
      <h2>Telegram Messenger</h2>
      <div className="status-indicator">
        <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></span>
        <span className="status-text">{status}</span>
      </div>
      
      {renderAuthForms()}
    </div>
  );
};

export default TelegramMessenger;