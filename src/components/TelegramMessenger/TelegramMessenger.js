import { TELEGRAM_API_ID, TELEGRAM_API_HASH } from './constants';
import { createEmptyFileStructure, parseFileStructure, serializeFileStructure } from '../../utils/fileStructureUtils';

import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import ChatGroupSelector from '../ChatGroupSelector/ChatGroupSelector';
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
    setMessageId: setContextMessageId,
    selectedChatId,
    setSelectedChatId,
    setAvailableChats
  } = useContext(TelegramContext);
  
  // Constants for localStorage keys
  const MESSAGE_ID_KEY = 'telegram-metadata-message-id';
  
  // Find message with METADATA_STORAGE prefix to enable message editing
  const findMessageId = useCallback(async () => {
    if (!clientRef.current || !getChatsPromiseRef.current || !selectedChatId) return null;
    
    try {
      // Wait for the getChats promise to resolve
      await getChatsPromiseRef.current;
      console.log("Searching for METADATA_STORAGE message...");
      
      console.log("Trying...localStorage first.")
      // First try to get message_id from localStorage
      const savedMessageId = localStorage.getItem(MESSAGE_ID_KEY);
      if (savedMessageId) {
        console.log("Found saved message ID in localStorage:", savedMessageId);
        try {
          // Verify the saved message still exists and contains METADATA_STORAGE
          const messageResult = await clientRef.current.send({
            "@type": "getMessage",
            "chat_id": selectedChatId,
            "message_id": parseInt(savedMessageId, 10)
          });
          
          if (messageResult && 
              messageResult.content && 
              messageResult.content.text && 
              messageResult.content.text.text && 
              messageResult.content.text.text.includes("METADATA_STORAGE")) {
            
            console.log("Verified saved message ID is valid:", savedMessageId);
            setMessageId(parseInt(savedMessageId, 10));
            setContextMessageId(parseInt(savedMessageId, 10));
            
            // Load file structure from message
            try {
              const parsedStructure = parseFileStructure(messageResult.content.text.text);
              console.log("Loaded file structure from saved message ID:", parsedStructure);
              setFileStructure(parsedStructure);
              setIsFileStructureLoaded(true);
              return parseInt(savedMessageId, 10);
            } catch (parseError) {
              console.error("Error parsing file structure from saved message:", parseError);
              // Continue to search methods if parsing fails
            }
          } else {
            console.log("Saved message ID is no longer valid, will search again");
            // Continue to search methods if saved ID is invalid
          }
        } catch (verifyError) {
          console.error("Error verifying saved message ID:", verifyError);
          // Continue to search methods if verification fails
        }
      }
      
      // Method 1: Try searchChatMessages first
      try {
        console.log("Trying searchChatMessages...");
        const searchResult = await clientRef.current.send({
          "@type": "searchChatMessages",
          "chat_id": selectedChatId,
          "query": "METADATA_STORAGE",
          "limit": 5,
          "from_message_id": 0,
          "offset": 0,
          "only_missed": false
        });
        
        if (searchResult.messages && searchResult.messages.length > 0) {
          const foundId = searchResult.messages[0].id;
          console.log("Found METADATA_STORAGE message with searchChatMessages, ID:", foundId);
          setMessageId(foundId);
          setContextMessageId(foundId);
          localStorage.setItem(MESSAGE_ID_KEY, foundId.toString());
          
          // Load file structure from message
          try {
            const messageContent = searchResult.messages[0].content;
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
          }
          
          return foundId;
        } else {
          console.log("No METADATA_STORAGE messages found with searchChatMessages");
          // Continue to fallback method
        }
      } catch (searchError) {
        console.error('Error with searchChatMessages:', searchError);
        // Continue to fallback method
      }
      
      // Method 2: Fallback to getChatHistory if searchChatMessages fails
      try {
        console.log("Falling back to getChatHistory...");
        let foundMessage = null;
        let fromMessageId = 0;
        const maxAttempts = 5; // NOTICE: Adjust this later if number of messages starts getting somewhat high(currently, per attempt=50 messages, 5 attempts = 50*5 = 250 messages it'll retrieve only. If your METADATA_STORAGE message is in the beginning of the chat, and you have more than 250 messages after that, you'll miss that METADATA_STORAGE message. If you expect a lot of messages, you SHOULD increase this limit. And this will definitely happen as you start storing files in it more and more and more.)
        
        for (let attempt = 0; attempt < maxAttempts && !foundMessage; attempt++) {
          const historyResult = await clientRef.current.send({
            "@type": "getChatHistory",
            "chat_id": selectedChatId,
            "from_message_id": fromMessageId,
            "offset": 0,
            "limit": 50, // Get 50 messages at a time
            "only_local": false
          });
          
          if (historyResult.messages && historyResult.messages.length > 0) {
            // Update fromMessageId for next iteration if needed
            fromMessageId = historyResult.messages[historyResult.messages.length - 1].id;
            
            // Search for METADATA_STORAGE in the messages
            foundMessage = historyResult.messages.find(msg => 
              msg.content && 
              msg.content.text && 
              msg.content.text.text && 
              msg.content.text.text.includes("METADATA_STORAGE")
            );
            
            if (foundMessage) {
              const foundId = foundMessage.id;
              console.log("Found METADATA_STORAGE message with getChatHistory, ID:", foundId);
              setMessageId(foundId);
              setContextMessageId(foundId);
              localStorage.setItem(MESSAGE_ID_KEY, foundId.toString());
              
              // Load file structure from message
              try {
                if (foundMessage.content && foundMessage.content.text && foundMessage.content.text.text) {
                  const parsedStructure = parseFileStructure(foundMessage.content.text.text);
                  console.log("Loaded file structure:", parsedStructure);
                  setFileStructure(parsedStructure);
                  setIsFileStructureLoaded(true);
                }
              } catch (error) {
                console.error("Error loading file structure:", error);
                setFileStructure(createEmptyFileStructure());
                setIsFileStructureLoaded(true);
              }
              
              return foundId;
            }
            
            // If we got fewer messages than requested, we've reached the end
            if (historyResult.messages.length < 50) {
              break;
            }
          } else {
            // No more messages to check
            break;
          }
        }
        
        // If we get here, we didn't find the message
        console.log("No METADATA_STORAGE messages found with getChatHistory");
        setFileStructure(createEmptyFileStructure());
        setIsFileStructureLoaded(true);
        return null;
      } catch (historyError) {
        console.error('Error with getChatHistory:', historyError);
        setFileStructure(createEmptyFileStructure());
        setIsFileStructureLoaded(true);
        return null;
      }
    } catch (error) {
      console.error('Error fetching message ID:', error);
      setFileStructure(createEmptyFileStructure());
      setIsFileStructureLoaded(true);
      return null;
    }
  }, [selectedChatId]);

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
              // Try to get the selected chat if available, otherwise this will fail and we'll try getChats instead
              if (!selectedChatId) {
                throw new Error('No chat selected');
              }
              const response = await clientRef.current.send({
                "@type": "getChat",
                "chat_id": selectedChatId
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
        window.tdClient = client;
        console.log("TDLib client created");
        
        // Set up event handling before setting parameters
        client.onUpdate = update => {
          // Safely check if update exists and has a type
          if (!update || typeof update !== 'object') return;
          
          try {
            
            // Only log specific update types we're interested in
            const allowedUpdates = [
              'updateFile', // This is not compulsory. You can disable if you want.
              'updateAuthorizationState', // These are COMPULSORY. Authentication process below depends on flow being passed to there.
              'updateMessageSendSucceeded' // These are COMPULSORY. Authentication process below depends on flow being passed to there.
            ];
            if (!allowedUpdates.includes(update["@type"])) {
              return; // CAUTION: this can skip not just logging, but authorization happening below
            }
              // console.log("TDLib update received:", update);
            
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
                  setAuthState('ready');
                  
                  // Initialize data and find message ID after a short delay
                  // TODO: We need to remove all the timeout things, rather find
                  // better solutions to chaining these things in deterministic fashion.
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
    
    // // Initialize Telegram with a small delay to ensure the script is loaded
    // console.log("Setting timeout for TDLib initialization...");
    // const timeoutId = setTimeout(initTelegram, 1000);
    initTelegram(); // NOTICE: We changed this in this to run without timeout, if anything errorneous happens, you may need to set it back to timeout again

    // Cleanup function
    return () => {
      console.log("Cleaning up TDLib resources...");
      // clearTimeout(timeoutId); // NOTICE: this was commented along with above initTelegram's moving from timeout to normal initTelegram. If you want to use timeout, you may need to set it back to clearTimeout again. I don't really know what it does, but it's there.
      if (clientRef.current) {
        clientRef.current.close();
      }
    };
  }, []); // NOTICE: we're removing this here in this commit, later if something breaks, you may need to re-set it to this. Currently, I don't think this was placed rightly.


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
      if (!selectedChatId) {
        throw new Error('No chat selected. Please select a chat group first.');
      }
      
      if (messageId) {
        await editMessage(message, messageId, selectedChatId);
      } else {
        await sendMessage(message, selectedChatId);
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
      
      // If this is a METADATA_STORAGE message, ensure its ID is saved to localStorage
      if (newMessage.includes("METADATA_STORAGE")) {
        console.log("Ensuring METADATA_STORAGE message ID is saved to localStorage:", message_id);
        localStorage.setItem(MESSAGE_ID_KEY, message_id.toString());
      }
      
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
      if (!selectedChatId) {
        throw new Error('No chat selected. Please select a chat group first.');
      }
      
      console.log('Updating file structure in chat ID:', selectedChatId);
      
      if (messageId) {
        await editMessage(messageText, messageId, selectedChatId);
      } else {
        const result = await sendMessage(messageText, selectedChatId);
        // If this is the first time sending the message, we need to update the messageId
        if (result && result.id && !messageId) {
          setMessageId(result.id);
          setContextMessageId(result.id);
          // Save the message ID to localStorage
          localStorage.setItem(MESSAGE_ID_KEY, result.id.toString());
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
   }, [messageId, selectedChatId]);
   
  // Clear message ID from localStorage when logging out
  useEffect(() => {
    if (!isConnected && authState === 'initial') {
      // If we're disconnected and back to initial auth state, clear the message ID
      // localStorage.removeItem(MESSAGE_ID_KEY); // WTF why did AI generate this even. why is this whole useEffect even here. WTF AI.
    }
  }, [isConnected, authState]);
  
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

      // If this is a METADATA_STORAGE message, save its ID to localStorage when we get it
      if (messageText.includes("METADATA_STORAGE") && result && result.id) {
        console.log("Saving new METADATA_STORAGE message ID to localStorage:", result.id);
        localStorage.setItem(MESSAGE_ID_KEY, result.id.toString());
      }

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

  // Effect to find message ID when selected chat changes
  useEffect(() => {
    if (isConnected && selectedChatId) {
      findMessageId();
    }
  }, [isConnected, selectedChatId, findMessageId]);

{/* I don't think this part where we're rendering anything or displaying ChatGroupSelector is needed. as we're doing all the Group selection processing and everything in Auth/GroupSelector.js. This was a legecy code when initially We used telegram messenger code as main code. Currently TelegramMessenger.js stays hidden off the screen, thus nothing needs to get displayed, just its updateAuthorizationState routing and telegramClient initialization etc are required which it can do from background i.e. when it is hidden and really we don't need to initialize the logic of ChatGroupSelector in it now.*/}
{/* this is a 
  block
  comment in JSX
  as it is down
  below. */}
{/*  return (
    <div className="telegram-messenger">
      <h2>Telegram Messenger</h2>
      <div className="status-indicator">
        <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></span>
        <span className="status-text">{status}</span>
      </div>
      
       {isConnected && <ChatGroupSelector />} 
      
      <div className={`messenger-container ${authState !== 'ready' ? 'visible' : 'hidden'}`}>
        {renderAuthForms()}
      </div>
    </div>
  ); */}

{/* We don't need to render anything since this component is just used for functional requirement which it'll perfom anyway, and user don't need to see anything thus we're returning null as render. */}
return null;

};

export default TelegramMessenger;