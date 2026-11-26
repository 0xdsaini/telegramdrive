import { TELEGRAM_API_ID, TELEGRAM_API_HASH } from './constants';
import { createGramTelegramClient } from '../../mtproto/gramTelegramClient';
import {
  createEmptyFileStructure,
  parseFileStructure,
  serializeFileStructure,
  getMetadataTimestampMs,
  stampFileStructureUpdatedAt,
  ensureMetadataUpdatedAtFromTelegram,
} from '../../utils/fileStructureUtils';

import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import ChatGroupSelector from '../ChatGroupSelector/ChatGroupSelector';
import { TelegramContext } from '../../context/TelegramContext';
import { runChatStorageBootstrap } from '../../utils/chatBootstrap';
import { debugLog, isAppDebugEnabled } from '../../utils/appDebug';
import {
  METADATA_MARKER,
  METADATA_FILENAME,
  isMetadataStorageMessage,
  pickCanonicalMetadataMessage,
  readSavedMetadataMessageId,
  rememberMetadataMessageId,
} from '../../utils/metadataStorageMessage';
import { collectChatHistoryMatches } from '../../utils/chatHistoryScan';
import './TelegramMessenger.css';

function decodeFilePartAsUtf8(data) {
  if (!data) {
    return '';
  }
  if (typeof data === 'string') {
    return data;
  }
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (data instanceof Uint8Array) {
    return new TextDecoder('utf-8').decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder('utf-8').decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  return String(data);
}

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
  const bootstrapGenerationRef = useRef(0);
  
  // Message ID for editing messages
  const [messageId, setMessageId] = useState(null);
  
  // Access the Telegram context
  const { 
    setFileStructure,
    setIsFileStructureLoaded,
    setIsThumbsStoreLoaded,
    setTelegramClient,
    setIsConnected: setContextIsConnected,
    setMessageId: setContextMessageId,
    selectedChatId,
    setSelectedChatId,
    setAvailableChats
  } = useContext(TelegramContext);
  
  // Helpers function to create File Blob from text
  const createMetadataFile = (metadataText) => {
    const blob = new Blob([metadataText], { type: 'application/json' });
    return new File([blob], METADATA_FILENAME, { type: 'application/json' });
  };

  const downloadFileandExtractMetadata = async (messageId) => {
    const client = clientRef.current || window.tdClient;
    if (!client || !selectedChatId) {
      throw new Error('Telegram client or chat is not ready');
    }

    let foundMessage = null;
    let foundId = null;

    const numericMessageId =
      messageId != null && messageId !== ''
        ? parseInt(String(messageId), 10)
        : NaN;

    if (Number.isFinite(numericMessageId)) {
      try {
        const messageResult = await client.send({
          '@type': 'getMessage',
          chat_id: selectedChatId,
          message_id: numericMessageId,
        });
        if (messageResult && isMetadataStorageMessage(messageResult)) {
          foundMessage = messageResult;
          foundId = messageResult.id;
        }
      } catch (getMessageError) {
        console.error('getMessage failed for metadata message:', getMessageError);
      }
    }

    if (!foundMessage) {
      try {
        console.log('Falling back to getChatHistory for METADATA_STORAGE...');
        const historyMatches = await collectChatHistoryMatches(
          client,
          selectedChatId,
          isMetadataStorageMessage,
        );
        foundMessage = pickCanonicalMetadataMessage(historyMatches);
        if (foundMessage) {
          foundId = foundMessage.id;
          console.log(
            'Found METADATA_STORAGE message with getChatHistory, ID:',
            foundId,
          );
        }
      } catch (historyError) {
        console.error('Error with getChatHistory:', historyError);
      }
    }

    if (!foundMessage) {
      throw new Error('METADATA_STORAGE message not found in this chat');
    }

    const editDateUnix =
      foundMessage.edit_date > 0 ? foundMessage.edit_date : foundMessage.date;

    if (!foundMessage.content?.document) {
      const textBody = foundMessage.content?.text?.text;
      if (!textBody) {
        throw new Error('METADATA_STORAGE message has no document or text body');
      }
      return { text: textBody, id: foundId ?? foundMessage.id, editDateUnix };
    }

    const docFile = foundMessage.content.document.document;
    if (!docFile?.id) {
      throw new Error('Metadata message has no attached document file');
    }

    const fileId = docFile.id;
    const size = docFile.size || 0;

    const part = await client.send({
      '@type': 'readFilePart',
      file_id: fileId,
      offset: 0,
      count: size > 0 ? size : 1024 * 1024,
    });

    const text = decodeFilePartAsUtf8(part?.data);

    console.log('Metadata JSON loaded via MTProto, bytes:', text.length);

    return { text, id: foundId ?? foundMessage.id, editDateUnix };
  }

  const loadFileStructureFromTelegram = (metadataText, editDateUnix) => {
    const parsed = parseFileStructure(metadataText);
    return ensureMetadataUpdatedAtFromTelegram(parsed, editDateUnix);
  };

  // Find message with METADATA_STORAGE prefix to enable message editing
  const findMessageId = useCallback(async () => {
    if (!clientRef.current || !selectedChatId) {
      setFileStructure(createEmptyFileStructure());
      setIsFileStructureLoaded(true);
      return null;
    }

    try {
      if (getChatsPromiseRef.current) {
        await getChatsPromiseRef.current;
      }
      console.log("Searching for METADATA_STORAGE message...");
      
      console.log("Trying...localStorage first.")
      // First try to get message_id from localStorage
      const savedMessageId = readSavedMetadataMessageId(selectedChatId);
      if (savedMessageId) {
        console.log("Found saved message ID in localStorage:", savedMessageId);
        try {
          // Verify the saved message still exists and contains METADATA_STORAGE
          const messageResult = await clientRef.current.send({
            "@type": "getMessage",
            "chat_id": selectedChatId,
            "message_id": parseInt(savedMessageId, 10)
          });
          
          if (messageResult && isMetadataStorageMessage(messageResult)) {
            console.log("Verified saved message ID is valid:", savedMessageId);
            const numericId = parseInt(savedMessageId, 10);
            setMessageId(numericId);
            setContextMessageId(numericId);
            rememberMetadataMessageId(selectedChatId, numericId);

            try {
              if (messageResult.content?.document) {
                const result = await downloadFileandExtractMetadata(numericId);
                const parsedStructure = loadFileStructureFromTelegram(
                  result.text,
                  result.editDateUnix,
                );
                setFileStructure(parsedStructure);
              } else {
                const parsedStructure = parseFileStructure(
                  messageResult.content.text.text,
                );
                setFileStructure(parsedStructure);
              }
              setIsFileStructureLoaded(true);
              console.log("Loaded file structure from saved message ID");
              return numericId;
            } catch (parseError) {
              console.error("Error parsing file structure from saved message:", parseError);
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
          "query": METADATA_MARKER,
          "limit": 50,
          "from_message_id": 0,
          "offset": 0,
          "only_missed": false
        });

        let canonical = pickCanonicalMetadataMessage(searchResult?.messages);
        if (!canonical) {
          const byFileName = await clientRef.current.send({
            '@type': 'searchChatMessages',
            chat_id: selectedChatId,
            query: METADATA_FILENAME,
            limit: 50,
            from_message_id: 0,
            offset: 0,
            only_missed: false,
          });
          canonical = pickCanonicalMetadataMessage(byFileName?.messages);
        }

        if (canonical) {
          const foundId = canonical.id;
          console.log("Found METADATA_STORAGE message with searchChatMessages, ID:", foundId);
          setMessageId(foundId);
          setContextMessageId(foundId);
          rememberMetadataMessageId(selectedChatId, foundId);

          try {
            const result = await downloadFileandExtractMetadata(foundId);
            console.log(
              "downloadFileandExtractMetadata(inside findMessageId->searchChatMessages)",
              result.text,
              typeof result.text,
            );
            const parsedStructure = loadFileStructureFromTelegram(
              result.text,
              result.editDateUnix,
            );
            console.log("Loaded file structure:", parsedStructure);
            setFileStructure(parsedStructure);
            setIsFileStructureLoaded(true);
            return foundId;
          } catch (error) {
            console.error("Error loading file structure:", error);
            setFileStructure(createEmptyFileStructure());
            setIsFileStructureLoaded(true);
          }
        } else {
          console.log("No METADATA_STORAGE messages found with searchChatMessages");
        }
      } catch (searchError) {
        console.error('Error with searchChatMessages:', searchError);
        // Continue to fallback method
      }
      
      // Method 2: Fallback to getChatHistory if searchChatMessages fails
      try {
        console.log("Falling back to getChatHistory...");
        const historyMatches = await collectChatHistoryMatches(
          clientRef.current,
          selectedChatId,
          isMetadataStorageMessage,
        );
        const foundMessage = pickCanonicalMetadataMessage(historyMatches);
        if (foundMessage) {
          const foundId = foundMessage.id;
          console.log("Found METADATA_STORAGE message with getChatHistory, ID:", foundId);
          setMessageId(foundId);
          setContextMessageId(foundId);
          rememberMetadataMessageId(selectedChatId, foundId);

          try {
            const result = await downloadFileandExtractMetadata(foundId);
            console.log(
              "downloadFileandExtractMetadata(inside findMessageId->getChatHistory)",
              result.text,
              typeof result.text,
            );
            const parsedStructure = loadFileStructureFromTelegram(
              result.text,
              result.editDateUnix,
            );
            console.log("Loaded file structure:", parsedStructure);
            setFileStructure(parsedStructure);
            setIsFileStructureLoaded(true);
            return foundId;
          } catch (error) {
            console.error("Error loading file structure:", error);
            setFileStructure(createEmptyFileStructure());
            setIsFileStructureLoaded(true);
          }
        }

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
  }, [selectedChatId, setContextMessageId, setFileStructure, setIsFileStructureLoaded]);

  const runChatBootstrap = useCallback(async () => {
    if (!clientRef.current || !selectedChatId) {
      return;
    }
    const generation = (bootstrapGenerationRef.current += 1);
    setIsThumbsStoreLoaded(false);
    const thumbsUiWait = typeof performance !== 'undefined' ? performance.now() : Date.now();
    try {
      await runChatStorageBootstrap({
        loadMetadata: findMessageId,
        client: clientRef.current,
        chatId: selectedChatId,
      });
      debugLog(
        '[thumbs-boot] ui-ready',
        Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - thumbsUiWait,
        ),
        'ms',
      );
      if (generation === bootstrapGenerationRef.current) {
        setIsThumbsStoreLoaded(true);
      }
    } catch (error) {
      console.error('Chat storage bootstrap failed:', error);
      if (generation === bootstrapGenerationRef.current) {
        setIsThumbsStoreLoaded(true);
      }
    }
  }, [findMessageId, selectedChatId, setIsThumbsStoreLoaded]);

  // Initialize MTProto (GramJS) with TDLib-compat shim for the rest of the app
  useEffect(() => {
    let cancelled = false;

    const initializeData = async () => {
      if (!clientRef.current) return;

      try {
        console.log('Initializing data...');
        getChatsPromiseRef.current = new Promise(async (resolve) => {
          try {
            try {
              if (!selectedChatId) {
                throw new Error('No chat selected');
              }
              const response = await clientRef.current.send({
                '@type': 'getChat',
                chat_id: selectedChatId,
              });
              console.log('getChat succeeded:', response);
              setIsConnected(true);
              setContextIsConnected(true);
              resolve(true);
            } catch (error) {
              console.log('getChat failed, trying getChats instead. Error:', error);
              try {
                const chatData = await clientRef.current.send({
                  '@type': 'getChats',
                  limit: 2000,
                });
                console.log('Chats fetched successfully:', chatData);
                setIsConnected(true);
                setContextIsConnected(true);
                resolve(chatData);
              } catch (getChatsError) {
                console.error('Error fetching chats with getChats:', getChatsError);
                resolve(null);
              }
            }
          } catch (chatError) {
            console.error('Error in chat initialization:', chatError);
            resolve(null);
          }
        });
        console.log('Initializing data finished');
      } catch (error) {
        console.error('Error initializing data:', error);
      }
    };

    const onAuthorized = async () => {
      setStatus('Connected to Telegram');
      setIsConnected(true);
      setContextIsConnected(true);
      setAuthState('ready');
      await initializeData();
      findMessageId();
      if (selectedChatId) {
        runChatBootstrap();
      }
    };

    const initGram = async () => {
      try {
        setStatus('Connecting (MTProto / GramJS)...');
        const client = await createGramTelegramClient();
        if (cancelled) return;

        clientRef.current = client;
        setTelegramClient(client);
        window.tdClient = client;

        client.onUpdate = (update) => {
          if (!update || typeof update !== 'object') return;

          if (update['@type'] === 'updateMessageSendSucceeded') {
            debugLog('Message sent successfully:', update.message);
            if (update.message.content?.text?.text?.includes('METADATA_STORAGE')) {
              debugLog('METADATA_STORAGE message id:', update.message.id);
              setMessageId(update.message.id);
            }
          }

          if (update['@type'] !== 'updateAuthorizationState' || !update.authorization_state) {
            return;
          }

          const currentAuthState = update.authorization_state['@type'];
          switch (currentAuthState) {
            case 'authorizationStateWaitPhoneNumber':
              setStatus('Please enter your phone number');
              setAuthState('waitPhoneNumber');
              break;
            case 'authorizationStateWaitCode':
              setStatus('Please enter the verification code');
              setAuthState('waitCode');
              break;
            case 'authorizationStateReady':
              onAuthorized();
              break;
            case 'authorizationStateClosed':
              setStatus('Connection closed');
              setIsConnected(false);
              setContextIsConnected(false);
              setAuthState('initial');
              break;
            default:
              break;
          }
        };

        if (client._gram && (await client._gram.checkAuthorization())) {
          await onAuthorized();
        } else {
          setStatus('Please sign in');
          setAuthState('waitPhoneNumber');
        }
      } catch (error) {
        console.error('GramJS init error:', error);
        setStatus(`Error: ${error.message || 'Failed to initialize MTProto client'}`);
      }
    };

    initGram();

    return () => {
      cancelled = true;
      if (clientRef.current?._gram) {
        clientRef.current._gram.disconnect().catch(() => {});
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

  const throwIfTdlibError = (result) => {
    if (result?.['@type'] === 'error') {
      throw new Error(result.message || `TDLib error (code ${result.code ?? 'unknown'})`);
    }
    return result;
  };

  // Edit an existing message in Telegram
  const editMessage = async (newMessage, message_id, chat_id) => {
    console.log("Editing message with ID:", message_id);

    // With file based metadata, it won't be compabitle with old telegram' interface's edit message. You can edit that function respectively if you want to use file based metadata with that.

    let newMetadataFile = createMetadataFile(newMessage);
    let message;

    try {
      message = throwIfTdlibError(
        await window.tdClient.send({
          '@type': 'editMessageMedia',
          'chat_id': chat_id,
          'message_id': message_id,
          'input_message_content': {
            '@type': 'inputMessageDocument',
            'document': {
              '@type': 'inputFileBlob',
              'name': newMetadataFile.name,
              'data': newMetadataFile,
            },
            'caption': {
              '@type': 'formattedText',
              'text': METADATA_MARKER,
            },
          },
        }),
      );

      console.log("Message sent just now", message);

      // let fileId = message.content.document.document.id;
      // console.log("messageId", fileId);

      // the message.id that's being passed to it is bogus/garbage. it don't
      // mean a thing.
      // let text = await downloadFileandExtractMetadata(message.id).text;
      // console.log("text(inside sendMessage): ", text);      

      // TODO: I don't think we can store message_id in localStorage here, because we're not getting it from the preceding function. Also is this this function's responsibility to store it in localStorage, I don't think so. But maybe yes, find out and resolve this matter
      // localStorage.setItem(MESSAGE_ID_KEY, result.id.toString());
      console.log('Message edited successfully');
      setStatus('Message edited successfully');
      
      // Reset status after 3 seconds
      setTimeout(() => {
        if (isConnected) {
          setStatus('Connected to Telegram');
        }
      }, 3000);

      // TODO: Fix this later.
      // The caller needs this message to access its message.id
      // which is garbage/random value given by telegram. real value is provided
      // by it in updateMessage or updateFile somewhat event. these values are
      // useless really.

      // TODO: Fix this, Hacky: wait for 1 second before returning
      await new Promise(resolve => setTimeout(resolve, 1000));
      return message;
      
    } catch(error) {
      console.error('Error sending message:', error);
      setStatus('Error sending message');
      throw error instanceof Error ? error : new Error(String(error));
    }

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
        rememberMetadataMessageId(selectedChatId, message_id);
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
      if (!selectedChatId) {
        throw new Error('No chat selected. Please select a chat group first.');
      }

      // Re-fetch Telegram metadata so two devices do not clobber each other.
      if (messageId) {
        const remote = await downloadFileandExtractMetadata(messageId);
        const remoteStructure = loadFileStructureFromTelegram(
          remote.text,
          remote.editDateUnix
        );
        const localTs = getMetadataTimestampMs(updatedStructure) ?? 0;
        const remoteTs =
          getMetadataTimestampMs(remoteStructure) ??
          (remote.editDateUnix ? remote.editDateUnix * 1000 : 0);

        if (remoteTs > localTs) {
          console.warn(
            'Remote metadata is newer than this device; refreshing local copy instead of uploading.',
            { localTs, remoteTs }
          );
          setFileStructure(remoteStructure);
          setStatus(
            'Metadata was updated on another device. Your view has been refreshed — retry your change.'
          );
          return false;
        }
      }

      const stampedStructure = stampFileStructureUpdatedAt(updatedStructure);
      setFileStructure(stampedStructure);

      const messageText = serializeFileStructure(stampedStructure);

      console.log('Updating file structure in chat ID:', selectedChatId);

      if (messageId) {
        await editMessage(messageText, messageId, selectedChatId);
      } else {
        const result = await sendMessage(messageText, selectedChatId);
        console.log("ResultId(in updateFileStructure):", result.id);
        if (result && result.id && !messageId) {
          setMessageId(result.id);
          setContextMessageId(result.id);
          rememberMetadataMessageId(selectedChatId, result.id);
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

    console.log("Inside sendMessage");

    let metadataFile = createMetadataFile(newMessage);
    let message;
    try {
      message = await window.tdClient.send({
        '@type': 'sendMessage',
        'chat_id': chat_id,
        'input_message_content': {
          '@type': 'inputMessageDocument',
          'document': {
            '@type': 'inputFileBlob',
            'name': metadataFile.name,
            'data': metadataFile
          },
            'caption': {
              '@type': 'formattedText',
              'text': METADATA_MARKER
            }
        }
      });

      console.log("Message sent just now", message);

      // let fileId = message.content.document.document.id;
      // console.log("messageId", fileId);

      // the message.id that's being passed to it is bogus/garbage. it don't
      // mean a thing.
      let result = await downloadFileandExtractMetadata(message.id);
      console.log("text(inside sendMessage): ", result);      

      // TODO: I don't think we can store message_id in localStorage here, because we're not getting it from the preceding function. Also is this this function's responsibility to store it in localStorage, I don't think so. But maybe yes, find out and resolve this matter
      // localStorage.setItem(MESSAGE_ID_KEY, result.id.toString());

      // Reset status after 3 seconds
      setTimeout(() => {
        if (isConnected) {
          setStatus('Connected to Telegram');
        }
      }, 3000);

      // TODO: Fix this later.
      // The caller needs this message to access its message.id
      // which is garbage/random value given by telegram. real value is provided
      // by it in updateMessage or updateFile somewhat event. these values are
      // useless really.

      // TODO: Fix this, Hacky: wait for 1 second before returning
      await new Promise(resolve => setTimeout(resolve, 1000));
      return result;
      
    } catch(error) {
      console.error('Error sending message:', error);
      setStatus('Error sending message');
      throw error;
    }
    // try {
    //   // Add METADATA_STORAGE prefix if this is a message we want to edit later
    //   const messageText = newMessage;
      
    //   const result = await clientRef.current.send({
    //     '@type': 'sendMessage',
    //     'chat_id': chat_id,
    //     'input_message_content': {
    //       '@type': 'inputMessageText',
    //       'text': {
    //         '@type': 'formattedText',
    //         'text': messageText
    //       }
    //     }
    //   });
      
    //   console.log('Message sent successfully');
    //   setStatus('Message sent successfully');

    //   // If this is a METADATA_STORAGE message, save its ID to localStorage when we get it
    //   if (messageText.includes("METADATA_STORAGE") && result && result.id) {
    //     console.log("Saving new METADATA_STORAGE message ID to localStorage:", result.id);
    //     localStorage.setItem(MESSAGE_ID_KEY, result.id.toString());
    //   }

    //   // Reset status after 3 seconds
    //   setTimeout(() => {
    //     if (isConnected) {
    //       setStatus('Connected to Telegram');
    //     }
    //   }, 3000);
      
    //   return result;
    // } catch (error) {
    //   console.error('Error sending message:', error);
    //   setStatus('Error sending message');
    //   throw error;
    // }
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
      runChatBootstrap();
    }
  }, [isConnected, selectedChatId, runChatBootstrap]);

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