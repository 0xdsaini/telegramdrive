import { TELEGRAM_API_ID, TELEGRAM_API_HASH, CHAT_ID } from './constants';
import { createEmptyFileStructure, parseFileStructure, serializeFileStructure } from '../../utils/fileStructureUtils';

import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { TelegramContext } from '../../context/TelegramContext';
import './TelegramMessenger.css';

const TelegramMessenger = () => {
  // State for message input and status
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('Initializing...');
  const [isSending, setIsSending] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  // Authentication states
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [authState, setAuthState] = useState('initial'); // initial, waitPhoneNumber, waitCode, ready
  
  // File handling states
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  
  // References
  const clientRef = useRef(null);
  const getChatsPromiseRef = useRef(null);
  const inputRef = useRef(null);
  
  // Message ID for editing messages
  const [messageId, setMessageId] = useState(null);
  
  // Access the Telegram context
  const { 
    setFileStructure, 
    setIsFileStructureLoaded,
    setTelegramClient,
    setIsConnected: setContextIsConnected,
    setMessageId: setContextMessageId
  } = useContext(TelegramContext);
  
  // Find message with METADATA_STORAGE prefix to enable message editing
  const findMessageId = useCallback(async () => {
    if (!clientRef.current || !getChatsPromiseRef.current) return null;
    
    try {
      // Wait for the getChats promise to resolve
      await getChatsPromiseRef.current;
      console.log("Searching for METADATA_STORAGE message...");
      
      // Search for messages containing METADATA_STORAGE
      const result = await clientRef.current.send({
        "@type": "searchChatMessages",
        "chat_id": CHAT_ID,
        "query": "METADATA_STORAGE",
        "limit": 5,
        "from_message_id": 0,
        "offset": 0,
        "only_missed": false
      });
      
      // Check if we found any messages
      if (result.messages && result.messages.length > 0) {
        const foundId = result.messages[0].id;
        console.log("Found METADATA_STORAGE message with ID:", foundId);
        setMessageId(foundId);
        setContextMessageId(foundId);
        
        // Load file structure from message
        try {
          const messageContent = result.messages[0].content;
          if (messageContent && messageContent.text && messageContent.text.text) {
            const parsedStructure = parseFileStructure(messageContent.text.text);
            console.log("Loaded file structure:", parsedStructure);
            setFileStructure(parsedStructure);
            setIsFileStructureLoaded(true);
          }
        } catch (error) {
          console.error("Error loading file structure:", error);
          setFileStructure(createEmptyFileStructure());
        setIsFileStructureLoaded(true);
          setIsFileStructureLoaded(true);
        }
        
        return foundId;
      } else {
        console.log("No METADATA_STORAGE messages found");
        setFileStructure(createEmptyFileStructure());
        setIsFileStructureLoaded(true);
        return null;
      }
    } catch (error) {
      console.error('Error fetching message ID:', error);
      return null;
    }
  }, []);

  // Initialize TDLib
  useEffect(() => {
    // Check if TDLib is available
    if (!window.tdweb || !window.tdweb.default) {
      setStatus('Error: TDLib not found. Please check if tdweb.js is properly loaded.');
      return;
    }

    // Initialize data after successful authentication
    const initializeData = async () => {
      if (!clientRef.current) return;
      
      try {
        console.log("Initializing data...");
        // Create a promise to fetch chats that can be awaited later
        getChatsPromiseRef.current = new Promise(async (resolve) => {
          try {
            // Try to get a specific chat first
            try {
              const response = await clientRef.current.send({
                "@type": "getChat",
                "chat_id": CHAT_ID
              });
              console.log("getChat succeeded:", response);
              setIsConnected(true);
        setContextIsConnected(true);
              resolve(true);
            } catch (error) {
              console.log("getChat failed, trying getChats instead. Error:", error);
              
              // If getting a specific chat fails, try to get all chats
              // Add a delay to ensure authorization is complete
              console.log("Adding delay before getChats...");
              await new Promise(resolve => setTimeout(resolve, 5000));
              console.log("Delay finished, now trying getChats");
              
              try {
                const chatData = await clientRef.current.send({
                  "@type": "getChats",
                  "limit": 2000
                });
                console.log("Chats fetched successfully:", chatData);
                setIsConnected(true);
        setContextIsConnected(true);
                resolve(chatData);
              } catch (getChatsError) {
                console.error("Error fetching chats with getChats:", getChatsError);
                resolve(null);
              }
            }
          } catch (chatError) {
            console.error("Error in chat initialization:", chatError);
            // Don't reject, just resolve with null to prevent unhandled promise rejections
            resolve(null);
          }
        });
        console.log("Initializing data finished");
      } catch (error) {
        console.error("Error initializing data:", error);
      }
    };

    const initTelegram = async () => {
      try {
        console.log("Starting TDLib initialization...");
        setStatus('Initializing TDLib...');

        // Create TDLib client
        const TdClient = window.tdweb.default;
        const client = new TdClient({
          logVerbosityLevel: 2, // Increased for more detailed logs
          jsLogVerbosityLevel: 'debug', // Changed to debug for more detailed logs
          mode: 'wasm',
          api_id: TELEGRAM_API_ID,
          api_hash: TELEGRAM_API_HASH,
        });
        
        clientRef.current = client;
        setTelegramClient(client);
        console.log("TDLib client created");
        
        // Set up event handling before setting parameters
        client.onUpdate = update => {
          // Safely check if update exists and has a type
          if (!update || typeof update !== 'object') return;
          
          try {
            console.log("TDLib update received:", update["@type"]);
            
            // Handle message send success events
            if (update['@type'] === 'updateMessageSendSucceeded') {
              console.log('Message sent successfully:', update.message);
              if (update.message.content?.text?.text?.includes("METADATA_STORAGE")) {
                console.log("METADATA_STORAGE message id:", update.message.id);
                setMessageId(update.message.id);
              }
            }
            
            // Handle authorization state changes
            if (update['@type'] === 'updateAuthorizationState' && update.authorization_state) {
              const currentAuthState = update.authorization_state['@type'];
              console.log('Auth state changed to:', currentAuthState);
              
              switch (currentAuthState) {
                case 'authorizationStateWaitTdlibParameters':
                  console.log("Waiting for TDLib parameters...");
                  setStatus('Setting up TDLib parameters...');
                  setAuthState('initial');
                  
                  // Send TDLib parameters immediately when we receive this state
                  setTimeout(async () => {
                    try {
                      console.log("Sending TDLib parameters...");
                      await client.send({
                        "@type": "setTdlibParameters",
                        "use_test_dc": false,
                        "database_directory": "/tdlib/dbfs",
                        "files_directory": "/tdlib/inboundfs",
                        "use_file_database": false,  // Prevents storing files
                        "use_chat_info_database": true,
                        "use_message_database": true,
                        "use_secret_chats": false,
                        "api_id": TELEGRAM_API_ID,
                        "api_hash": TELEGRAM_API_HASH,
                        "system_language_code": "en",
                        "device_model": "Web",
                        "system_version": "TDLib",
                        "application_version": "1.0",
                        "enable_storage_optimizer": true,
                        "ignore_file_names": false,
                        "is_background": false
                      });
                      console.log("TDLib parameters sent successfully");
                    } catch (paramError) {
                      console.error("Error setting TDLib parameters:", paramError);
                      setStatus(`Error: ${paramError.message || 'Failed to set TDLib parameters'}`);
                    }
                  }, 100);
                  break;
                  
                case 'authorizationStateWaitEncryptionKey':
                  console.log("Waiting for encryption key...");
                  setStatus('Setting up encryption...');
                  
                  // Send empty encryption key
                  setTimeout(async () => {
                    try {
                      console.log("Sending empty encryption key...");
                      await client.send({
                        "@type": "checkDatabaseEncryptionKey",
                        "encryption_key": ""
                      });
                      console.log("Encryption key sent successfully");
                    } catch (encryptionError) {
                      console.error("Error setting encryption key:", encryptionError);
                      setStatus(`Error: ${encryptionError.message || 'Failed to set encryption key'}`);
                    }
                  }, 100);
                  break;
                  
                case 'authorizationStateWaitPhoneNumber':
                  console.log("Ready for phone number input");
                  setStatus('Please enter your phone number');
                  setAuthState('waitPhoneNumber');
                  break;
                  
                case 'authorizationStateWaitCode':
                  console.log("Ready for verification code input");
                  setStatus('Please enter the verification code');
                  setAuthState('waitCode');
                  break;
                  
                case 'authorizationStateReady':
                  console.log("Authorization completed successfully");
                  setStatus('Connected to Telegram');
                  setIsConnected(true);
                  setContextIsConnected(true);
        setContextIsConnected(true);
                  setAuthState('ready');
                  
                  // Initialize data and find message ID after a short delay
                  setTimeout(() => {
                    initializeData();
                    findMessageId();
                  }, 1000);
                  break;
                  
                case 'authorizationStateClosed':
                  console.log("Connection closed");
                  setStatus('Connection closed');
                  setIsConnected(false);
                  setAuthState('initial');
                  break;
                  
                default:
                  console.log("Unhandled auth state:", currentAuthState);
                  break;
              }
            } else if (update['@type'] === 'error') {
              console.error('TDLib error:', update);
              setStatus(`Error: ${update.message || 'Unknown error'}`);
            }
          } catch (err) {
            console.error('Error handling TDLib update:', err);
          }
        };
        
        console.log("Event handler set up, proceeding with initialization...");
        setStatus('Connecting to Telegram...');

      } catch (error) {
        console.error('TDLib initialization error:', error);
        setStatus(`Error: ${error.message || 'Failed to initialize TDLib'}`);
      }
    };
    
    // Initialize Telegram with a small delay to ensure the script is loaded
    console.log("Setting timeout for TDLib initialization...");
    const timeoutId = setTimeout(initTelegram, 1000);

    // Cleanup function
    return () => {
      console.log("Cleaning up TDLib resources...");
      clearTimeout(timeoutId);
      if (clientRef.current) {
        clientRef.current.close();
      }
    };
  }, [findMessageId]);


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
  
  // Handle message submission
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

      // If we have a messageId, edit that message, otherwise send a new one
      if (messageId) {
        await editMessage(message, messageId, CHAT_ID);
      } else {
        await sendMessage(message, CHAT_ID);
      }
      
      // Clear the message input after sending
      setMessage('');
      
    } catch (error) {
      console.error('Failed to send/edit message:', error);
      setStatus(`Error: ${error.message || 'Failed to send/edit message'}`);
    } finally {
      setIsSending(false);
    }
  };

  // Edit an existing message in Telegram
  const editMessage = async (newMessage, message_id, chat_id) => {
    console.log("Editing message with ID:", message_id);

    try {
      const result = await clientRef.current.send({
        '@type': 'editMessageText',
        'chat_id': chat_id,
        'message_id': message_id,
        'input_message_content': {
          '@type': 'inputMessageText',
          'text': {
            '@type': 'formattedText',
            'text': newMessage
          }
        }
      });

      console.log('Message edited successfully');
      setStatus('Message edited successfully');
      
      // Reset status after 3 seconds
      setTimeout(() => {
        if (isConnected) {
          setStatus('Connected to Telegram');
        }
      }, 3000);
      
      return result;
    } catch (error) {
      console.error('Error editing message:', error);
      setStatus('Error editing message');
      throw error;
    }
  };

  // Update file structure in Telegram
  const updateFileStructure = async (updatedStructure) => {
    try {
      setFileStructure(updatedStructure);
      
      // Serialize the file structure to message text
      const messageText = serializeFileStructure(updatedStructure);
      
      // If we have a messageId, edit that message, otherwise send a new one
      if (messageId) {
        await editMessage(messageText, messageId, CHAT_ID);
      } else {
        const result = await sendMessage(messageText, CHAT_ID);
        // If this is the first time sending the message, we need to update the messageId
        if (result && result.id && !messageId) {
          setMessageId(result.id);
          setContextMessageId(result.id);
        }
      }
      
      return true;
    } catch (error) {
      console.error('Failed to update file structure:', error);
      setStatus(`Error: ${error.message || 'Failed to update file structure'}`);
      return false;
    }
  };
  
  // Expose the updateFileStructure function to the context
  useEffect(() => {
    // Add a method to the window object that the FileExplorer can call
    window.updateTelegramFileStructure = updateFileStructure;
  }, [messageId]);

  // Send a new message to Telegram
  const sendMessage = async (newMessage, chat_id) => {
    console.log("Sending new message to chat ID:", chat_id);

    try {
      // Add METADATA_STORAGE prefix if this is a message we want to edit later
      const messageText = newMessage;
      
      const result = await clientRef.current.send({
        '@type': 'sendMessage',
        'chat_id': chat_id,
        'input_message_content': {
          '@type': 'inputMessageText',
          'text': {
            '@type': 'formattedText',
            'text': messageText
          }
        }
      });
      
      console.log('Message sent successfully');
      setStatus('Message sent successfully');

      // Reset status after 3 seconds
      setTimeout(() => {
        if (isConnected) {
          setStatus('Connected to Telegram');
        }
      }, 3000);
      
      return result;
    } catch (error) {
      console.error('Error sending message:', error);
      setStatus('Error sending message');
      throw error;
    }
  }
  
  // Render authentication forms based on current auth state
  const renderAuthForms = () => {
    return (
      <div className="auth-forms-container">
        {/* Phone Number Form - Show when waiting for phone number */}
        {(authState === 'initial' || authState === 'waitPhoneNumber') && (
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
                autoFocus={authState === 'waitPhoneNumber'}
              />
              <button 
                type="submit" 
                className="auth-button"
                disabled={!phoneNumber.trim() || authState !== 'waitPhoneNumber'}
              >
                Send Code
              </button>
            </form>
          </div>
        )}

        {/* Verification Code Form - Show when waiting for verification code */}
        {(authState === 'waitCode' || authState === 'ready') && (
          <div className="auth-section">
            <h3>Step 2: Verification Code</h3>
            <form onSubmit={handleVerificationCodeSubmit} className="auth-form">
              <input
                type="text"
                value={verificationCode}
                onChange={handleVerificationCodeChange}
                placeholder="Enter verification code"
                className="auth-input"
                required
                disabled={authState !== 'waitCode'}
                autoFocus={authState === 'waitCode'}
              />
              <button 
                type="submit" 
                className="auth-button"
                disabled={!verificationCode.trim() || authState !== 'waitCode'}
              >
                Verify
              </button>
            </form>
          </div>
        )}

        {/* Message Form - Show when authenticated */}
        {authState === 'ready' && (
          <div className="message-section">
            <h3>Send Message</h3>
            <form onSubmit={handleSubmit} className="message-form">
              <input
                type="text"
                value={message}
                onChange={handleMessageChange}
                placeholder="Type your message"
                className="message-input"
                ref={inputRef}
                disabled={!isConnected || isSending}
              />
              <button 
                type="submit" 
                className="send-button"
                disabled={!message.trim() || !isConnected || isSending}
              >
                {messageId ? 'Update' : 'Send'}
              </button>
            </form>
          </div>
        )}
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