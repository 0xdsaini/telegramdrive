import { TELEGRAM_API_ID, TELEGRAM_API_HASH, CHAT_ID } from './constants';

import React, { useState, useEffect, useRef } from 'react';
import './TelegramMessenger.css';

let messageId = '';

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

  // Global variable:
  // Best practice, use React Context for pan-Component global variable.
  // not good practice: window.var = <something> works but can be overridden in runtime
  // use window.var method if this useState doesn't work.
  const [messageId, setMessageId] = useState([]);

  const inputRef = useRef(null);
  
  const findMessageId = async () => {

    if (!clientRef.current || !getChatsPromiseRef.current) return;
    // Wait for the getChats promise to resolve
    const chatData = await getChatsPromiseRef.current;
    console.log("Chat Data:", chatData); 
    console.error("Finding messageId...");

    console.error("Chat Id", CHAT_ID);
    try {

      // Its not detecting let's say METADATA_STORAGE<any text>
      const result = await clientRef.current.send({
        "@type": "searchChatMessages",
        "chat_id": -4744438579,
        "query": "METADATA_STORAGE",
        "limit": 5,
        "from_message_id": 0,
        "offset": 0,
        "only_missed": false
      })

      console.error("finding messageId...")
      // console for searchChatMessages:
      console.error("searchChatMessages result:", result);
      console.error("searchChatMessages result messages[0] id:", result.messages[0].id);
      setMessageId(result.messages[0].id);

      console.error(messageId);

      // also return the found id
      return result.messages[0].id;

      // // Try to get chatHistory and we'll find that message ourselves
      // const result = await clientRef.current.send({
      //   "@type": "getChatHistory",
      //   "chat_id": CHAT_ID,
      //   "from_message_id": 0,
      //   "offset": 0,
      //   "limit": 50, // NOTICE: limit is 100 ONLY
      //   "only_local": false
      // });
      // // console.log("Chat History fetched:", result);
      // // Check if the result contains messages
      // if (!result.messages || result.messages.length === 0) {
      //   console.log("No messages found");
      //   return;
      // }
      // // search for message containing our prefix
      // // const message = result.messages.find(msg => msg.content.text.text.includes("METADATA_STORAGE"));
      // console.error("messages: ", result.messages);



      // Set messageId to the ID of the first message in the result
      // setMessageId(result.messages[0].id);

    }
    catch (error) {
      console.error('Error fetching message ID:', error);
    }
  };

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
          api_id: TELEGRAM_API_ID,
          api_hash: TELEGRAM_API_HASH,
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
          "api_id": TELEGRAM_API_ID,  // Replace with your API ID
          "api_hash": TELEGRAM_API_HASH, // Replace with your API Hash
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

          console.log("all update(disable this in onUpdate init function):", update);
          // Safely check if update exists and has a type
          if (!update || typeof update !== 'object') return;
          
          try {
            console.log('TDLib update:', update);

            // When a new message is sent, to obtain its message id, we'll need to listen for updateMessageSendSucceeded event
            if (update['@type'] === 'updateMessageSendSucceeded') {
              console.error('Message sent successfully:', update.message);
              if (update.message.content.text.text.includes("METADATA_STORAGE")) {
                console.error("METADATA_STORAGE found in message:", update.message);
                console.error("METADATA_STORAGE message id:", update.message.id);
                setMessageId(update.message.id);
              }
            }
            
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
                findMessageId();
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

      } catch (error) {
        console.error('TDLib initialization error:', error);
        setStatus(`Error: ${error.message || 'Failed to initialize TDLib'}`);
      }
    };

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
                "chat_id": CHAT_ID // You might need to replace this with a valid chat ID
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
                "limit": 2000
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

      await sendMessage(message, CHAT_ID);
      setMessage("edited the same message");
      console.error("sent message's id", messageId);
      console.error("new message to send:", message);

      setTimeout(() => {
        console.error("editing message after 3 seconds", messageId, CHAT_ID);
        editMessage("new message", messageId, CHAT_ID);
      }, 3000);

      setIsSending(false);
      // if (messageId && messageId !== '') {
      //   await editMessage(message, message_id, CHAT_ID);
      // } else {
      //   await sendMessage(message, CHAT_ID);
      // }
      
    } catch (error) {
      console.error('Failed to edit message:', error);
      setStatus(`Error: ${error.message || 'Failed to edit message'}`);
    } finally {
      setIsSending(false);
    }
  };

  // Edit message in telegram - function
  const editMessage = async (newMessage, message_id, chat_id) => {

    console.error("Editing message", newMessage, message_id);

    // Edit the message in the chat
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

      console.error('Message edited:', result);
      setStatus('Message edited successfully');
      // setMessage('');
      setIsSending(false);
      return;
    } catch (editError) {
      console.error('Error editing message:', editError);
      setStatus('Error editing message');
      setIsSending(false);
      return;
    }

  }

  const sendMessage = async (newMessage, chat_id) => {

    console.error("Sending message", newMessage);
    console.error("messageId:", chat_id);

    // Try to send the message directly to the specified chat
    try {
      const result = await clientRef.current.send({
        '@type': 'sendMessage',
        'chat_id': chat_id,
        'input_message_content': {
          '@type': 'inputMessageText',
          'text': {
            '@type': 'formattedText',
            'text': newMessage
          }
        }
      });
      
      console.error('Message sent:', result);
      setStatus('Message sent successfully');

      // Reset status after 3 seconds
      setTimeout(() => {
        if (isConnected) {
          setStatus('Connected to Telegram');
        }
      }, 3000);

      // for some reason result.id is wrong id telegram is returning. we'll need to search for our message again.
      // return message id back to caller.
      // return result.id;

      return

      // await findMessageId();
      // let newMesssageId = await findMessageId();

      // return newMesssageId

    } catch (sendError) {
      console.error('Error sending to specific chat:', sendError);
      setStatus('Message sent successfully');
    }

    return;
  }
  
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