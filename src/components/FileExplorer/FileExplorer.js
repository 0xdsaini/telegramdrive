import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useContext,
  useCallback,
} from 'react';
import './FileExplorer.css';
import { FaFile, FaFileImage, FaFileAlt, FaFileCode, FaMusic, FaFolder, FaFolderPlus, FaTrash, FaArrowUp, FaPlus, FaUpload, FaHome, FaCheck, FaLink } from 'react-icons/fa';
import FileGridItem from './FileGridItem';
import FolderGridItem from './FolderGridItem';
import VideoPlayerModal from '../VideoPlayer/VideoPlayerModal';
import VideoPosterTile from './VideoPosterTile';
import { resolveTelegramFile } from '../../utils/telegramFileResolver';
import { getStreamUrl } from '../../utils/streamUrl';
import {
  isAudioFileName,
  isAudioPlayback,
  isStreamableMediaFileName,
  isStreamableMimeType,
  isVideoFileName,
  mimeTypeFromTelegramContent,
} from '../../utils/mimeTypes';
import {
  findFolderUploadFileCollisions,
  planFolderUpload,
} from '../../utils/folderUpload';
import {
  formatByteSize,
  TELEGRAM_MAX_FILE_BYTES,
} from '../../utils/telegramDocumentUpload';
import { runBatchDocumentUpload } from '../../utils/batchDocumentUpload';
import {
  displayNameFromUrl,
  sendDocumentFromUrlMtproto,
} from '../../mtproto/sendDocumentFromUrlMtproto';
import { streamDebug, streamDebugError } from '../../utils/streamDebug';
import {
  lockLandscapeForPlayback,
  lockPortraitForPlayback,
} from '../../utils/playbackOrientation';
import {
  prepareForStreaming,
  registerPlaybackFileId,
  setPlaybackModalOpen,
  unregisterPlaybackFileId,
} from '../../utils/streamBridge';
import { requestTdlibFilePart } from '../../utils/tdlibFilePartReader';
import { downloadTelegramFileWithStreaming } from '../../utils/streamingDownload';
import {
  createEmptyFileStructure,
  findFolderByPath,
  createFolder,
  deleteFolder,
  renameFolder,
  moveFolder,
  addFile,
  addFileByFolderId,
  deleteFile,
  moveFile,
  renameFile,
} from '../../utils/fileStructureUtils';
import { TelegramContext } from '../../context/TelegramContext';
import UntrackedFilesPanel, { useUntrackedFiles } from './UntrackedFilesPanel';
import UntrackedFilesToggle from './UntrackedFilesToggle';
import { useExplorerKeyboardNav } from './useExplorerKeyboardNav';
import { isDesktopFinePointer } from '../../utils/deviceInput';
import {
  parseExplorerUrlFromLocation,
  buildExplorerBrowserPathname,
  pushExplorerBrowserUrl,
  readPendingExplorerPath,
  replaceExplorerBrowserUrl,
  resolveExplorerLocation,
} from '../../utils/explorerUrl';
import { findSiblingSubtitleFile } from '../../utils/siblingSubtitles';
import {
  loadSidecarSubtitleObjectUrl,
  revokeSidecarSubtitleObjectUrl,
} from '../../utils/loadSidecarSubtitle';

/** User move/delete/rename/create — local tree wins on conflict (no union merge). */
const EXPLORER_METADATA_SAVE = { saveIntent: 'explorer' };

const CLOSED_STREAM_PLAYER = {
  open: false,
  url: '',
  title: '',
  fileId: null,
  audioOnly: false,
  subtitleTrackUrl: null,
};

// (function() {
//   const originalLog = console.log;
//   let logData = [];

//   console.log = function(...args) {
//     const formattedArgs = args.map(arg => {
//       if (typeof arg === 'object') {
//         return JSON.stringify(arg, null, 2); // Properly format objects
//       }
//       return arg;
//     });

//     const logEntry = `[${new Date().toISOString()}] ${formattedArgs.join(' ')}`;
//     logData.push(logEntry);
//     originalLog.apply(console, args);
//   };

//   window.saveLogs = function() {
//     const blob = new Blob([logData.join('\n')], { type: 'text/plain' });
//     const a = document.createElement('a');
//     a.href = URL.createObjectURL(blob);
//     a.download = 'console_logs.txt';
//     a.click();
//   };
// })();


// Helper function to determine the appropriate icon based on file extension
const getFileIcon = (filename) => {
  const extension = filename.split('.').pop().toLowerCase();
  
  if (['mp3', 'm4a', 'ogg', 'opus', 'wav', 'flac', 'aac', 'wma', 'aiff', 'aif', 'mid', 'midi'].includes(extension)) {
    return <FaMusic />;
  }

  // Image files
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'bmp', 'webp'].includes(extension)) {
    return <FaFileImage />;
  }
  
  // Code files
  if (['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'py', 'java', 'c', 'cpp', 'php', 'rb', 'go'].includes(extension)) {
    return <FaFileCode />;
  }
  
  // Text/Document files
  if (['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv', 'json'].includes(extension)) {
    return <FaFileAlt />;
  }
  
  // Default file icon for unknown types
  return <FaFile />;
};

const FileExplorer = () => {
  const [currentPath, setCurrentPath] = useState('/');
  const [currentFolder, setCurrentFolder] = useState(null);
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [streamPlayer, setStreamPlayer] = useState({ ...CLOSED_STREAM_PLAYER });
  const sidecarSubtitleUrlRef = useRef(null);
  const urlSuppressRef = useRef(false);
  const urlWriteModeRef = useRef('replace');
  const initialUrlAppliedRef = useRef(false);
  const pendingPlayFileRef = useRef(null);
  const keyboardOpenFileRef = useRef(() => {});
  const explorerRootRef = useRef(null);
  const explorerContentRef = useRef(null);
  const explorerScrollSnapshotRef = useRef(null);
  const [showDesktopNavChrome, setShowDesktopNavChrome] = useState(() => isDesktopFinePointer());

  const clearSidecarSubtitleBlob = useCallback(() => {
    revokeSidecarSubtitleObjectUrl(sidecarSubtitleUrlRef.current);
    sidecarSubtitleUrlRef.current = null;
  }, []);

  const getExplorerScrollTargets = useCallback(() => {
    const targets = [explorerContentRef.current, explorerRootRef.current];
    const parent = explorerRootRef.current?.parentElement;
    if (parent && parent.scrollHeight > parent.clientHeight + 1) {
      targets.push(parent);
    }
    return targets.filter(Boolean);
  }, []);

  const captureExplorerScroll = useCallback(() => {
    explorerScrollSnapshotRef.current = getExplorerScrollTargets()
      .filter((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollTop > 0 || el.scrollLeft > 0)
      .map((el) => ({ el, scrollTop: el.scrollTop, scrollLeft: el.scrollLeft }));
  }, [getExplorerScrollTargets]);

  const restoreExplorerScroll = useCallback(() => {
    const snapshot = explorerScrollSnapshotRef.current;
    if (!snapshot?.length) {
      return;
    }
    const apply = () => {
      snapshot.forEach(({ el, scrollTop, scrollLeft }) => {
        if (!el.isConnected) {
          return;
        }
        el.scrollTop = scrollTop;
        el.scrollLeft = scrollLeft;
      });
    };
    apply();
    requestAnimationFrame(() => {
      apply();
      requestAnimationFrame(apply);
    });
  }, []);

  const wasStreamOpenRef = useRef(false);

  useLayoutEffect(() => {
    if (streamPlayer.open) {
      wasStreamOpenRef.current = true;
      return undefined;
    }
    if (!wasStreamOpenRef.current) {
      return undefined;
    }
    wasStreamOpenRef.current = false;

    restoreExplorerScroll();
    const timers = [50, 150, 350].map((ms) => window.setTimeout(restoreExplorerScroll, ms));
    const onOrientation = () => restoreExplorerScroll();
    window.addEventListener('orientationchange', onOrientation);
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      window.removeEventListener('orientationchange', onOrientation);
    };
  }, [streamPlayer.open, restoreExplorerScroll]);

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = () => setShowDesktopNavChrome(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Access the Telegram context
  const { 
    fileStructure, 
    updateFileStructure, 
    isFileStructureLoaded, 
    isConnected,
    telegramClient,
    selectedChatId,
    clearDownloadedFiles,
    isDryModeEnabled
  } = useContext(TelegramContext);

  const preparePlayback = useCallback(
    (opts) => prepareForStreaming(telegramClient, opts),
    [telegramClient]
  );

  const untrackedFilesState = useUntrackedFiles({
    currentPath,
    onSuccess: setSuccess,
    onError: setError,
  });

  useEffect(() => {
    setPlaybackModalOpen(streamPlayer.open);
    if (!streamPlayer.open && streamPlayer.fileId != null) {
      unregisterPlaybackFileId(streamPlayer.fileId);
    }
  }, [streamPlayer.open, streamPlayer.fileId]);

  useEffect(() => {
    if (!isConnected || !telegramClient) {
      return;
    }
    prepareForStreaming(telegramClient, {
      allowReload: false,
      timeoutMs: 12_000,
    }).catch((err) => {
      streamDebug('play', 'background prepareForStreaming', { err: err?.message });
    });
  }, [isConnected, telegramClient]);

  const syncExplorerToAddressBar = useCallback(() => {
    if (urlSuppressRef.current) {
      return;
    }
    const playingFile = streamPlayer.open && streamPlayer.title ? streamPlayer.title : null;
    const mode = urlWriteModeRef.current;
    urlWriteModeRef.current = 'replace';
    if (mode === 'push') {
      pushExplorerBrowserUrl(currentPath, playingFile);
    } else {
      replaceExplorerBrowserUrl(currentPath, playingFile);
    }
  }, [currentPath, streamPlayer.open, streamPlayer.title]);

  const applyExplorerFromAddressBar = useCallback(
    (explorerPath) => {
      if (!fileStructure) {
        return;
      }
      const resolved = resolveExplorerLocation(fileStructure, explorerPath);
      if (!resolved.valid && explorerPath !== '/') {
        setError('Folder or file not found.');
      }
      setCurrentPath(resolved.folderPath);
      if (resolved.fileName) {
        pendingPlayFileRef.current = resolved.fileName;
      } else if (streamPlayer.open) {
        if (streamPlayer.fileId != null) {
          unregisterPlaybackFileId(streamPlayer.fileId);
        }
        clearSidecarSubtitleBlob();
        setStreamPlayer({ ...CLOSED_STREAM_PLAYER });
      }
    },
    [fileStructure, streamPlayer.fileId, streamPlayer.open, clearSidecarSubtitleBlob],
  );

  useEffect(() => {
    syncExplorerToAddressBar();
  }, [syncExplorerToAddressBar]);

  useEffect(() => {
    const onPopState = () => {
      urlSuppressRef.current = true;
      applyExplorerFromAddressBar(parseExplorerUrlFromLocation());
      urlSuppressRef.current = false;
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [applyExplorerFromAddressBar]);

  useEffect(() => {
    if (!fileStructure || !isFileStructureLoaded || initialUrlAppliedRef.current) {
      return;
    }
    initialUrlAppliedRef.current = true;
    urlSuppressRef.current = true;
    let explorerPath = parseExplorerUrlFromLocation();
    const pending = readPendingExplorerPath();
    if (pending) {
      explorerPath = pending;
    }
    applyExplorerFromAddressBar(explorerPath);
    urlSuppressRef.current = false;
    urlWriteModeRef.current = 'replace';
    syncExplorerToAddressBar();
  }, [
    fileStructure,
    isFileStructureLoaded,
    applyExplorerFromAddressBar,
    syncExplorerToAddressBar,
  ]);
  
  // Update current folder when file structure or path changes
  useEffect(() => {
    if (fileStructure) {
      updateCurrentFolder();
    }
  }, [fileStructure, currentPath]);
  
  // Update current folder based on current path
  const updateCurrentFolder = () => {
    if (currentPath === '/') {
      setCurrentFolder(fileStructure);
      return;
    }
    
    const folder = findFolderByPath(fileStructure, currentPath);
    if (folder) {
      setCurrentFolder(folder);
    } else {
      // If folder not found, reset to root
      setCurrentPath('/');
      setCurrentFolder(fileStructure);
    }
  };

  const handleCreateFolder = async (folderName) => {
    try {
      setError(null);
      setSuccess(null);
      
      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }
      
      if (!selectedChatId) {
        setError('No chat group selected. Please select a chat group first.');
        return;
      }
      
      // Validate folder name
      if (!folderName || folderName.includes('/')) {
        setError('Invalid folder name. Folder name cannot be empty or contain "/"');
        return;
      }
      
      setSuccess("Creating folder...Updating Telegram Servers...");
      // Create folder in the file structure
      const updatedStructure = createFolder(fileStructure, currentPath, folderName);
      
      // Update the file structure in Telegram
      const success = await window.updateTelegramFileStructure(
        updatedStructure,
        EXPLORER_METADATA_SAVE,
      );
      
      if (success) {
        setSuccess(`Folder "${folderName}" created successfully`);
      } else {
        setError('Failed to create folder');
      }
    } catch (error) {
      console.error('Failed to create folder:', error);
      setError('Failed to create folder: ' + error.message);
    }
  };

  const handleNewFolderClick = () => {
    const folderName = prompt('Enter folder name:');
    if (folderName) {
      handleCreateFolder(folderName);
    }
  };

  // Helper function to recursively collect all files in a folder and its subfolders
  const collectFilesInFolder = (folder, path = '') => {
    let files = [];
    
    // Add files in current folder
    if (folder.files && Array.isArray(folder.files)) {
      files = folder.files.map(file => ({
        ...file,
        path: path
      }));
    }
    
    // Recursively add files from subfolders
    if (folder.subfolders && Array.isArray(folder.subfolders)) {
      for (const subfolder of folder.subfolders) {
        const subfolderPath = path === '/' ? `/${subfolder.name}` : `${path}/${subfolder.name}`;
        const subfolderFiles = collectFilesInFolder(subfolder, subfolderPath);
        files = [...files, ...subfolderFiles];
      }
    }
    
    return files;
  };

  const handleRenameFolder = async (folderName, e) => {
    e?.stopPropagation?.();

    const newNameRaw = window.prompt('Enter new folder name:', folderName);
    if (newNameRaw == null) {
      return;
    }

    const newName = newNameRaw.trim();
    if (!newName || newName.includes('/')) {
      setError('Invalid folder name. Folder name cannot be empty or contain "/"');
      return;
    }

    if (newName === folderName) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);

      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }

      if (!selectedChatId) {
        setError('No chat group selected. Please select a chat group first.');
        return;
      }

      const folderPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
      const parent = findFolderByPath(fileStructure, currentPath);
      if (parent?.subfolders?.some((f) => f.name === newName)) {
        setError(`A folder named "${newName}" already exists here`);
        return;
      }

      const before = JSON.stringify(fileStructure);
      const updatedStructure = renameFolder(fileStructure, folderPath, newName);
      if (JSON.stringify(updatedStructure) === before) {
        setError('Failed to rename folder');
        return;
      }

      const success = await window.updateTelegramFileStructure(
        updatedStructure,
        EXPLORER_METADATA_SAVE,
      );
      if (!success) {
        setError('Failed to rename folder');
        return;
      }

      const renamedPath =
        currentPath === '/' ? `/${newName}` : `${currentPath}/${newName}`;
      if (currentPath === folderPath || currentPath.startsWith(`${folderPath}/`)) {
        const suffix =
          currentPath === folderPath ? '' : currentPath.slice(folderPath.length);
        urlWriteModeRef.current = 'replace';
        setCurrentPath(`${renamedPath}${suffix}`);
      }

      setSuccess(`Folder renamed to "${newName}"`);
    } catch (error) {
      console.error('Failed to rename folder:', error);
      setError(`Failed to rename folder: ${error.message}`);
    }
  };

  const handleRenameFile = async (fileName, e) => {
    e?.stopPropagation?.();

    const newNameRaw = window.prompt('Enter new file name:', fileName);
    if (newNameRaw == null) {
      return;
    }

    const newName = newNameRaw.trim();
    if (!newName || newName.includes('/')) {
      setError('Invalid file name. Name cannot be empty or contain "/"');
      return;
    }

    if (newName === fileName) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);

      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }

      if (!selectedChatId) {
        setError('No chat group selected. Please select a chat group first.');
        return;
      }

      const folder = findFolderByPath(fileStructure, currentPath);
      if (!folder) {
        setError(`Folder not found: ${currentPath}`);
        return;
      }

      if (folder.files.some((f) => f.filename === newName)) {
        setError(`A file named "${newName}" already exists here`);
        return;
      }

      const before = JSON.stringify(fileStructure);
      const updatedStructure = renameFile(fileStructure, currentPath, fileName, newName);
      if (JSON.stringify(updatedStructure) === before) {
        setError('Failed to rename file');
        return;
      }

      const success = await window.updateTelegramFileStructure(
        updatedStructure,
        EXPLORER_METADATA_SAVE,
      );
      if (!success) {
        setError('Failed to rename file');
        return;
      }

      const urlResolved = resolveExplorerLocation(fileStructure, parseExplorerUrlFromLocation());
      if (urlResolved.fileName === fileName) {
        urlWriteModeRef.current = 'replace';
        replaceExplorerBrowserUrl(currentPath, newName);
      }
      if (pendingPlayFileRef.current === fileName) {
        pendingPlayFileRef.current = newName;
      }
      if (streamPlayer.open && streamPlayer.title === fileName) {
        setStreamPlayer((prev) => ({ ...prev, title: newName }));
      }

      setSuccess(`File renamed to "${newName}"`);
    } catch (error) {
      console.error('Failed to rename file:', error);
      setError(`Failed to rename file: ${error.message}`);
    }
  };

  const handleDeleteFolder = async (folderName, e) => {
    e.stopPropagation(); // Prevent folder navigation when clicking delete
    
    if (!window.confirm(`Are you sure you want to delete the folder "${folderName}"?`)) {
      return;
    }

    try {
      setError(null);
      setSuccess(null);
      
      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }
      
      const folderPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
      
      // Find the folder to delete
      const folderToDelete = findFolderByPath(fileStructure, folderPath);
      if (!folderToDelete) {
        setError(`Folder not found: ${folderPath}`);
        return;
      }

      console.log("dry mode: ", isDryModeEnabled);
      let DRY_MODE;
      // if there is no dry mode, assume it to be true by default. Safety first!
      if (isDryModeEnabled === true || isDryModeEnabled === false) {
        DRY_MODE = isDryModeEnabled;
      } else {
        // if it is not true or false, assume it is a string and try to parse it
        DRY_MODE = true;
      }


      // Use the isDryModeEnabled state from TelegramContext
      // Collect all files in the folder and its subfolders
      const filesToDelete = collectFilesInFolder(folderToDelete, folderPath);
      console.log(`Found ${filesToDelete.length} files to delete in folder ${folderPath}`);
      
      // Delete all files from Telegram
      for (const file of filesToDelete) {
        if (file.message_id) {
          if (!DRY_MODE) {
            try {
              await telegramClient.send({
                '@type': 'deleteMessages',
                'chat_id': selectedChatId,
                'message_ids': [file.message_id],
                'revoke': true
              });
              console.log(`Deleted message with ID: ${file.message_id} for file: ${file.filename}`);
            } catch (deleteError) {
              console.error(`Error deleting message for file ${file.filename}: ${deleteError.message}`);
              // Continue with other files even if one deletion fails
            }
          } else {
              console.log(`Dry Mode enabled: Not deleting file : ${file.message_id} for file: ${file.filename}`);
          }
        }
      }
      
      // Delete folder from the file structure
      const updatedStructure = deleteFolder(fileStructure, folderPath);
      
      // Update the file structure in Telegram
      const success = await window.updateTelegramFileStructure(
        updatedStructure,
        EXPLORER_METADATA_SAVE,
      );
      
      if (success) {
        setSuccess(`Folder "${folderName}" and all its contents deleted successfully`);
      } else {
        setError('Failed to delete folder');
      }
    } catch (error) {
      console.error('Failed to delete folder:', error);
      setError('Failed to delete folder: ' + error.message);
    }
  };

  // This function is no longer needed as we're using the TelegramContext
  // to manage the file structure

  const closeStreamPlayer = useCallback(() => {
    clearSidecarSubtitleBlob();
    setStreamPlayer((prev) => {
      if (prev.fileId != null) {
        unregisterPlaybackFileId(prev.fileId);
      }
      if (!prev.open) {
        return prev;
      }
      return { ...CLOSED_STREAM_PLAYER };
    });
  }, [clearSidecarSubtitleBlob]);

  const handlePathClick = (index) => {
    urlWriteModeRef.current = 'push';
    closeStreamPlayer();
    if (index === 0) {
      setCurrentPath('/');
      setCurrentFolder(fileStructure);
      return;
    }

    const pathSegments = currentPath.split('/').filter(Boolean);
    const newPathSegments = pathSegments.slice(0, index);
    const newPath = '/' + newPathSegments.join('/');
    
    setCurrentPath(newPath);
    
    let current = fileStructure;
    for (const segment of newPathSegments) {
      const nextFolder = current.subfolders.find(folder => folder.name === segment);
      if (!nextFolder) {
        console.error(`Folder ${segment} not found`);
        return;
      }
      current = nextFolder;
    }
    
    setCurrentFolder(current);
  };

  const handleFolderClick = (folderName) => {
    urlWriteModeRef.current = 'push';
    closeStreamPlayer();
    const newPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
    setCurrentPath(newPath);
    
    const targetFolder = currentFolder.subfolders.find(folder => folder.name === folderName);
    if (targetFolder) {
      setCurrentFolder(targetFolder);
    }
  };

  const goToParent = useCallback(() => {
    if (currentPath === '/') {
      return;
    }
    handlePathClick(currentPath.split('/').filter(Boolean).length - 1);
  }, [currentPath, fileStructure]);

  const {
    selectedIndex,
    setSelectedIndex,
    setItemRef,
    gridItems,
  } = useExplorerKeyboardNav({
    currentFolder,
    currentPath,
    onOpenFolder: handleFolderClick,
    onOpenFile: (fileName) => keyboardOpenFileRef.current(fileName),
    onGoParent: goToParent,
    streamOpen: streamPlayer.open,
    untrackedPanelOpen: untrackedFilesState.isPanelVisible,
  });

  // Drag and drop event handlers are defined below

  // First implementation of handleFolderDrop

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
    
    if (e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      setSuccess(`Preparing to upload ${droppedFiles.length} file(s)...`);
      handleFiles(droppedFiles);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('drag-over');
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
  };

  const handleDragEnd = (e) => {
    e.preventDefault();
    // Remove drag-over and drag-invalid classes from all elements
    document.querySelectorAll('.drag-over').forEach(element => {
      element.classList.remove('drag-over');
    });
    document.querySelectorAll('.drag-invalid').forEach(element => {
      element.classList.remove('drag-invalid');
    });
  };
  
  // This is the most complete implementation of handleFolderDragOver
  const handleFolderDragOver = (e, folderName) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event bubbling to parent containers
    
    // Get the drag data to check if it's a valid drop target
    const dragData = e.dataTransfer.getData('text/plain');
    if (dragData.startsWith('folder:')) {
      const sourcePath = dragData.replace('folder:', '');
      const destPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
      
      // Check if it's an invalid drop target (itself or its child)
      if (sourcePath === destPath || destPath.startsWith(sourcePath + '/')) {
        e.currentTarget.classList.add('drag-invalid');
        e.currentTarget.classList.remove('drag-over');
      } else {
        e.currentTarget.classList.add('drag-over');
        e.currentTarget.classList.remove('drag-invalid');
      }
    } else if (dragData.startsWith('file:')) {
      // Always valid for files
      e.currentTarget.classList.add('drag-over');
      e.currentTarget.classList.remove('drag-invalid');
    } else {
      e.currentTarget.classList.add('drag-over');
    }
  };
  
  // Handle leaving a folder during drag
  const handleFolderDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event bubbling
    e.currentTarget.classList.remove('drag-over');
    e.currentTarget.classList.remove('drag-invalid');
  };
  
  // Handle dropping on a specific folder
  const handleFolderDrop = async (e, folderName) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event bubbling to parent containers
    e.currentTarget.classList.remove('drag-over');
    
    if (!isConnected || !telegramClient) {
      setError('Not connected to Telegram. Please authenticate first.');
      return;
    }
    
    // Handle file drops from the file system
    if (e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      handleFiles(droppedFiles);
      return;
    }

    // Get drag data
    const dragData = e.dataTransfer.getData('text/plain');
    console.log("dragData: ", dragData);
    console.log("folderName: ", folderName);
    
    // NOTICE: ERRORNEOUS ZONE: This is problematic. we're relying on folderName(the destination folder) being undefined as a definitive way to determine if the drop is on the parent folder area. We should be using a better method, like passing the destination folder's path to this function or something more robust like that.
    // Note: this was working fine in commit, 29a52edc5ab6db0fa0c260608e221c112d452c1a. Maybe you'd like to study this part from there.

    // Check if this is a drop on the parent folder area (when folderName is undefined and we're not at root)
    const isParentFolderDrop = !folderName && currentPath !== '/';
    
    // Handle folder drops
    if (dragData.startsWith('folder:')) {
      const sourcePath = dragData.replace('folder:', '');
      
      let destPath;
      if (isParentFolderDrop) {
        // If dropping on parent folder area, set destination to parent directory
        const pathSegments = currentPath.split('/').filter(Boolean);
        pathSegments.pop(); // Remove the last segment to get the parent path
        destPath = pathSegments.length === 0 ? '/' : '/' + pathSegments.join('/');
      } else {
        // Normal folder drop - either on a specific folder or in the current directory
        destPath = folderName ? 
          (currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`) : 
          currentPath;
      }
      
      // Normalize paths for comparison
      const normalizedSourcePath = sourcePath.startsWith('/') ? sourcePath : `/${sourcePath}`;
      const normalizedDestPath = destPath.startsWith('/') ? destPath : `/${destPath}`;
      
      // Check if source and destination are the same folder
      if (normalizedSourcePath === normalizedDestPath) {
        setError('Cannot move a folder into itself');
        return;
      }
      
      // Check if destination is a subfolder of source
      if (normalizedDestPath.startsWith(normalizedSourcePath + '/')) {
        setError('Cannot move a folder into its subfolder');
        return;
      }
      
      console.log('Source Path:', sourcePath);
      console.log('Destination Path:', destPath);
    
      try {
        setError(null);
        setSuccess(null);
        
        // Move folder in the file structure
        const updatedStructure = moveFolder(fileStructure, sourcePath, destPath);
        
        // Update the file structure in Telegram
        const success = await window.updateTelegramFileStructure(
          updatedStructure,
          EXPLORER_METADATA_SAVE,
        );
        
        if (success) {
          setSuccess(`Folder moved successfully to ${destPath}`);
        } else {
          setError('Failed to move folder');
        }
      } catch (error) {
        console.error('Failed to move folder:', error);
        setError('Failed to move folder: ' + error.message);
      }
    }
    // Handle file drops
    else if (dragData.startsWith('file:')) {
      const sourceFilePath = dragData.replace('file:', '');
      const fileName = sourceFilePath.split('/').pop();
      
      let destPath;
      if (isParentFolderDrop) {
        // If dropping on parent folder area, set destination to parent directory
        const pathSegments = currentPath.split('/').filter(Boolean);
        pathSegments.pop(); // Remove the last segment to get the parent path
        destPath = pathSegments.length === 0 ? '/' : '/' + pathSegments.join('/');
      } else {
        // Normal file drop - either on a specific folder or in the current directory
        destPath = folderName ? 
          (currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`) : 
          currentPath;
      }
      
      // Get the parent path of the source file
      const sourcePathSegments = sourceFilePath.split('/').filter(Boolean);
      const sourceParentPathSegments = sourcePathSegments.slice(0, -1);
      const sourceParentPath = sourceParentPathSegments.length === 0 ? '/' : '/' + sourceParentPathSegments.join('/');
      
      // Check if we're dropping to the same folder (current location)
      const sourceFullPath = sourceFilePath;
      const destFullPath = destPath === '/' ? `/${fileName}` : `${destPath}/${fileName}`;
      
      if (sourceFullPath === destFullPath) {
        setSuccess('File is already in this location');
        return;
      }
      
      console.log('Source File Path:', sourceFilePath);
      console.log('Destination Path:', destPath);
    
      try {
        setError(null);
        setSuccess(null);
        
        // Move file in the file structure
        const updatedStructure = moveFile(fileStructure, sourceParentPath, fileName, destPath);
        
        // Update the file structure in Telegram
        const success = await window.updateTelegramFileStructure(
          updatedStructure,
          EXPLORER_METADATA_SAVE,
        );
        
        if (success) {
          setSuccess(`File "${fileName}" moved successfully to ${destPath}`);
        } else {
          setError('Failed to move file');
        }
      } catch (error) {
        console.error('Failed to move file:', error);
        setError('Failed to move file: ' + error.message);
      }
    }
  };

  const handleFiles = (newFiles) => {
    uploadFiles(newFiles);
  };

  const handleFolderSelect = (e) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (e.target) {
      e.target.value = '';
    }
    if (selectedFiles.length > 0) {
      uploadFolder(selectedFiles);
    }
  };

  const uploadFolder = async (filesToUpload) => {
    if (!isConnected || !telegramClient) {
      setError('Not connected to Telegram. Please authenticate first.');
      return;
    }
    if (!selectedChatId) {
      setError('No chat group selected. Please select a chat group first.');
      return;
    }
    if (!window.updateTelegramFileStructure || typeof window.updateTelegramFileStructure !== 'function') {
      setError('File upload system is not properly initialized. Please refresh the page and try again.');
      return;
    }

    const plan = planFolderUpload(fileStructure, currentPath, filesToUpload);
    if (!plan.ok) {
      if (plan.reason === 'oversized' && plan.oversized?.length) {
        const detail = plan.oversized
          .map((f) => `• ${f.displayName} (${formatByteSize(f.size)})`)
          .join('\n');
        window.alert(
          `Upload cancelled.\n\nThe following file(s) exceed Telegram's 2 GB limit:\n\n${detail}`,
        );
        setError(plan.message);
      } else {
        setError(plan.message || 'Could not prepare folder upload.');
      }
      return;
    }

    const collisions = findFolderUploadFileCollisions(plan.structureWithFolders, plan.entries);
    if (collisions.length > 0) {
      const proceed = window.confirm(
        `${collisions.length} file(s) already exist in this drive and will be replaced if you continue. Upload anyway?`,
      );
      if (!proceed) {
        return;
      }
    }

    setError(null);
    setSuccess(null);
    setUploading(true);

    let workingStructure = plan.structureWithFolders;
    const folderLabel =
      plan.resolvedRootName !== plan.originalRootName
        ? `"${plan.originalRootName}" as "${plan.resolvedRootName}"`
        : `"${plan.resolvedRootName}"`;

    try {
      const batchItems = plan.entries
        .filter((entry) => entry.file.size > 0)
        .map((entry) => ({
          file: entry.file,
          key: entry.filename,
          displayName: entry.filename,
          meta: { targetFolderId: entry.targetFolderId },
        }));

      const emptyCount = plan.entries.length - batchItems.length;
      if (emptyCount > 0) {
        setError(`Skipped ${emptyCount} empty file(s) in folder.`);
      }
      if (batchItems.length === 0) {
        setError('No files to upload in this folder.');
        return;
      }

      setSuccess(
        `Preparing folder ${folderLabel} (${batchItems.length} file(s)) for pipelined upload...`,
      );
      await window.updateTelegramFileStructure(workingStructure, { localOnly: true });

      const { uploaded, total, errors } = await runBatchDocumentUpload({
        telegramClient,
        chatId: selectedChatId,
        items: batchItems,
        saveMetadata: (structure, opts) =>
          window.updateTelegramFileStructure(structure, {
            ...opts,
            saveIntent: 'upload',
          }),
        getStructure: () => workingStructure,
        onUploadSuccess: (_structure, item, messageId) => {
          const { targetFolderId } = item.meta || {};
          if (targetFolderId == null) {
            console.error(`Missing folder id for ${item.key}`);
            return;
          }
          workingStructure = addFileByFolderId(
            workingStructure,
            targetFolderId,
            item.key,
            messageId,
          );
          void window.updateTelegramFileStructure(workingStructure, { localOnly: true });
        },
        onProgress: (p) => setUploadProgress(p),
        onCount: (done, batchTotal) => {
          setSuccess(`Uploading ${done}/${batchTotal} file(s)...`);
        },
      });

      if (errors.length > 0) {
        const first = errors[0];
        setError(
          `Failed to upload ${first.item?.displayName || first.item?.key}: ${
            first.error?.message || 'Unknown error'
          }`,
        );
      }

      if (uploaded === total) {
        setSuccess(
          `Uploaded folder ${folderLabel} (${uploaded} file(s)) under ${currentPath === '/' ? 'Home' : currentPath}.`,
        );
      } else if (uploaded > 0) {
        setSuccess(`Partial upload: ${uploaded}/${total} file(s) in folder ${folderLabel}.`);
      }
    } catch (error) {
      console.error('Failed to upload folder:', error);
      setError(`Failed to upload folder: ${error.message || 'Unknown error'}`);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };
  
  const uploadFiles = async (filesToUpload) => {
    try {
      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }
      
      if (!selectedChatId) {
        setError('No chat group selected. Please select a chat group first.');
        return;
      }
      
      // Check if the updateTelegramFileStructure function is available
      if (!window.updateTelegramFileStructure || typeof window.updateTelegramFileStructure !== 'function') {
        console.error('updateTelegramFileStructure function is not available');
        setError('File upload system is not properly initialized. Please refresh the page and try again.');
        return;
      }
      
      setError(null);
      setSuccess(null);
      setUploading(true);
      let workingStructure = fileStructure;

      const batchItems = [];
      for (const file of filesToUpload) {
        const folderExists = findFolderByPath(workingStructure, currentPath);
        if (folderExists) {
          const fileExists = folderExists.files.some((f) => f.filename === file.name);
          if (fileExists) {
            if (!window.confirm(`File ${file.name} already exists. Do you want to replace it?`)) {
              continue;
            }
          }
        }

        if (!file.size) {
          setError(`Failed to read file ${file.name}: Empty file`);
          continue;
        }

        if (file.size > TELEGRAM_MAX_FILE_BYTES) {
          setError(
            `File ${file.name} is too large (${formatByteSize(file.size)}). Maximum size is 2 GB.`,
          );
          continue;
        }

        batchItems.push({
          file,
          key: file.name,
          displayName: file.name,
        });
      }

      if (batchItems.length === 0) {
        setUploading(false);
        return;
      }

      const { uploaded, total, errors } = await runBatchDocumentUpload({
        telegramClient,
        chatId: selectedChatId,
        items: batchItems,
        saveMetadata: (structure, opts) =>
          window.updateTelegramFileStructure(structure, {
            ...opts,
            saveIntent: 'upload',
          }),
        getStructure: () => workingStructure,
        onUploadSuccess: (_structure, item, messageId) => {
          workingStructure = addFile(workingStructure, currentPath, item.key, messageId);
          void window.updateTelegramFileStructure(workingStructure, { localOnly: true });
        },
        onProgress: (p) => setUploadProgress(p),
        onCount: (done, batchTotal) => {
          setSuccess(`Uploading ${done}/${batchTotal} file(s)...`);
        },
      });

      if (errors.length > 0) {
        const first = errors[0];
        setError(
          `Failed to upload ${first.item?.displayName || first.item?.key}: ${
            first.error?.message || 'Unknown error'
          }`,
        );
      } else if (uploaded === total) {
        setSuccess(`Successfully uploaded ${uploaded} file(s).`);
      }

      setUploading(false);
      setUploadProgress(null);
    } catch (error) {
      console.error('Failed to upload files:', error);
      setError('Failed to upload files: ' + error.message);
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleUploadFromUrl = async () => {
    const url = window.prompt('HTTPS URL of the file (public, no auth):');
    if (!url?.trim()) {
      return;
    }

    if (!isConnected || !telegramClient?._gram) {
      setError('Not connected to Telegram. Please authenticate first.');
      return;
    }
    if (!selectedChatId) {
      setError('No chat group selected. Please select a chat group first.');
      return;
    }
    if (
      !window.updateTelegramFileStructure
      || typeof window.updateTelegramFileStructure !== 'function'
    ) {
      setError('File upload system is not properly initialized. Please refresh the page and try again.');
      return;
    }

    const defaultName = displayNameFromUrl(url.trim());
    const fileName =
      window.prompt('Save as filename:', defaultName)?.trim() || defaultName;

    setError(null);
    setSuccess(null);
    setUploading(true);
    setUploadProgress(null);
    setSuccess('Telegram is fetching the file from URL...');

    try {
      const gram = telegramClient._gram;
      const { message, rewritten, rewriteNote } = await sendDocumentFromUrlMtproto(
        gram,
        selectedChatId,
        url.trim(),
      );
      const messageId =
        typeof message.id === 'bigint' ? Number(message.id) : Number(message.id);
      if (!Number.isFinite(messageId)) {
        throw new Error(`Invalid message id after URL upload: ${String(message.id)}`);
      }

      let workingStructure = fileStructure;
      const folderExists = findFolderByPath(workingStructure, currentPath);
      if (folderExists?.files?.some((f) => f.filename === fileName)) {
        if (!window.confirm(`File ${fileName} already exists. Do you want to replace it?`)) {
          setSuccess(`Sent to Telegram (message ${messageId}); not added to folder index.`);
          return;
        }
      }

      workingStructure = addFile(workingStructure, currentPath, fileName, messageId);
      await window.updateTelegramFileStructure(workingStructure, { localOnly: true });
      await window.updateTelegramFileStructure(workingStructure, {
        saveIntent: 'upload',
      });
      setSuccess(
        rewritten
          ? `Uploaded from URL: ${fileName} (${rewriteNote || 'via mirror'})`
          : `Uploaded from URL: ${fileName}`,
      );
    } catch (error) {
      console.error('Failed to upload from URL:', error);
      const detail = error.message || 'Unknown error';
      setError(
        /WEBPAGE_CURL_FAILED/i.test(detail)
          ? `URL upload failed: Telegram could not fetch that URL (${detail}). `
            + 'Some hosts (e.g. GitHub raw) block Telegram; try jsDelivr (cdn.jsdelivr.net/gh/…) or a direct file CDN.'
          : `URL upload failed: ${detail}`,
      );
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  // No external API is needed, we're using the Telegram client directly with selectedChatId

  const handleDeleteFile = async (fileName, e) => {
    e.stopPropagation(); // Prevent any parent click events
    
    if (!window.confirm(`Are you sure you want to delete the file "${fileName}"?`)) {
      return;
    }

    try {
      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }
      
      if (!selectedChatId) {
        setError('No chat group selected. Please select a chat group first.');
        return;
      }
      
      setError(null);
      setSuccess(null);
      
      // Find the file in the current folder to get its message_id
      const folder = findFolderByPath(fileStructure, currentPath);
      if (!folder) {
        setError(`Folder not found: ${currentPath}`);
        return;
      }
      
      const fileToDelete = folder.files.find(f => f.filename === fileName);
      if (!fileToDelete) {
        setError(`File not found: ${fileName}`);
        return;
      }
      
      const messageId = fileToDelete.message_id;
      if (!messageId) {
        setError(`No message ID found for file: ${fileName}`);
        return;
      }

      console.log("dry mode: ", isDryModeEnabled);
      // if there is no dry mode, assume it to be true by default. Safety first!

      let DRY_MODE;
      // if there is no dry mode, assume it to be true by default. Safety first!
      if (isDryModeEnabled === true || isDryModeEnabled === false) {
        DRY_MODE = isDryModeEnabled;
      } else {
        // if it is not true or false, assume it is a string and try to parse it
        DRY_MODE = true;
      }

      // Use isDryModeEnabled from TelegramContext

      if (!DRY_MODE) {
        // Delete the actual file message from Telegram
        try {
          await telegramClient.send({
            '@type': 'deleteMessages',
            'chat_id': selectedChatId,
            'message_ids': [messageId],
            'revoke': true
          });
          console.log(`Deleted message with ID: ${messageId}`);
        } catch (deleteError) {
          console.error(`Error deleting message: ${deleteError.message}`);
          // Continue with metadata deletion even if message deletion fails
        }
      } else {
          // Dry Mode: Log the message ID without deleting it with filename
          console.log(`Dry Mode enabled: Not deleting file: ${messageId} (${fileName})`);
      }
      
      // Delete file from the file structure
      const updatedStructure = deleteFile(fileStructure, currentPath, fileName);
      
      // Update the file structure in Telegram
      const success = await window.updateTelegramFileStructure(
        updatedStructure,
        EXPLORER_METADATA_SAVE,
      );
      
      if (success) {
        setSuccess(`File "${fileName}" deleted successfully`);
      } else {
        setError('Failed to delete file');
      }
    } catch (error) {
      console.error('Failed to delete file:', error);
      setError('Failed to delete file: ' + error.message);
    }
  };

  const openStreamForFile = useCallback(
    async (fileName, e) => {
      e?.stopPropagation?.();
      captureExplorerScroll();
      if (isAudioFileName(fileName)) {
        void lockPortraitForPlayback();
      } else {
        void lockLandscapeForPlayback();
      }
      streamDebug('play', 'handleStreamPlay click', {
        fileName,
        swController: !!navigator.serviceWorker?.controller,
      });

      try {
        if (!isConnected || !telegramClient) {
          streamDebugError('play', 'not connected', new Error('no telegramClient'));
          setError('Not connected to Telegram. Please authenticate first.');
          return;
        }
        if (!selectedChatId) {
          setError('No chat group selected.');
          return;
        }

        const folder = findFolderByPath(fileStructure, currentPath);
        if (!folder) {
          setError(`Folder not found: ${currentPath}`);
          return;
        }

        const fileEntry = folder.files.find((f) => f.filename === fileName);
        if (!fileEntry?.message_id) {
          setError(`No message ID for file: ${fileName}`);
          return;
        }

        clearSidecarSubtitleBlob();
        const sidecarEntry = findSiblingSubtitleFile(folder.files, fileName);

        urlWriteModeRef.current = 'push';
        setError(null);
        setStreamPlayer({
          open: true,
          url: '',
          title: fileName,
          fileId: null,
          audioOnly: isAudioFileName(fileName),
          subtitleTrackUrl: null,
        });

        const [resolved] = await Promise.all([
          resolveTelegramFile(
            telegramClient,
            selectedChatId,
            fileName,
            fileEntry.message_id,
          ),
          prepareForStreaming(telegramClient, { allowReload: true, timeoutMs: 12_000 }).catch(
            (prepareErr) => {
              streamDebugError('play', 'prepareForStreaming (parallel)', prepareErr);
            },
          ),
        ]);
        streamDebug('play', 'resolveTelegramFile OK', {
          fileName,
          fileId: resolved.fileId,
          size: resolved.size,
          messageId: resolved.messageId,
          metadataMessageId: fileEntry.message_id,
        });

        const mimeType = mimeTypeFromTelegramContent(resolved.message, fileName);
        if (!isStreamableMimeType(mimeType)) {
          clearSidecarSubtitleBlob();
          setStreamPlayer({ ...CLOSED_STREAM_PLAYER });
          setError(`This file type cannot be streamed: ${fileName}`);
          return;
        }

        const audioOnly = isAudioPlayback(fileName, resolved.message);

        const streamUrl = getStreamUrl({
          fileId: resolved.fileId,
          size: resolved.size,
          mimeType,
          fileName,
          messageId: resolved.messageId,
          chatId: selectedChatId,
        });
        streamDebug('play', 'stream URL built', { streamUrl, mime: mimeType });

        const headLimit = Math.min(
          resolved.size > 0 ? resolved.size : 1024 * 1024,
          1024 * 1024,
        );
        if (headLimit > 0) {
          requestTdlibFilePart(
            telegramClient,
            resolved.fileId,
            resolved.size,
            0,
            headLimit,
          ).catch((prefetchErr) => {
            streamDebugError('play', 'stream head prefetch', prefetchErr);
          });
        }

        registerPlaybackFileId(resolved.fileId);
        urlWriteModeRef.current = 'push';
        setStreamPlayer({
          open: true,
          url: streamUrl,
          title: fileName,
          fileId: resolved.fileId,
          audioOnly,
          subtitleTrackUrl: null,
        });

        if (sidecarEntry && !audioOnly) {
          loadSidecarSubtitleObjectUrl(telegramClient, selectedChatId, sidecarEntry)
            .then((subtitleUrl) => {
              setStreamPlayer((prev) => {
                if (!prev.open || prev.title !== fileName) {
                  revokeSidecarSubtitleObjectUrl(subtitleUrl);
                  return prev;
                }
                clearSidecarSubtitleBlob();
                sidecarSubtitleUrlRef.current = subtitleUrl;
                return { ...prev, subtitleTrackUrl: subtitleUrl };
              });
            })
            .catch((subErr) => {
              streamDebugError('play', 'sidecar subtitle', subErr);
            });
        }

        setSuccess(null);
      } catch (playError) {
        streamDebugError('play', 'handleStreamPlay failed', playError);
        clearSidecarSubtitleBlob();
        setStreamPlayer({ ...CLOSED_STREAM_PLAYER });
        setError(playError.message || 'Failed to start streaming playback.');
      }
    },
    [
      currentPath,
      fileStructure,
      isConnected,
      selectedChatId,
      telegramClient,
      updateFileStructure,
      captureExplorerScroll,
      clearSidecarSubtitleBlob,
    ],
  );

  const handleStreamPlay = (fileName, e) => {
    void openStreamForFile(fileName, e);
  };

  keyboardOpenFileRef.current = (fileName) => {
    if (isStreamableMediaFileName(fileName)) {
      void openStreamForFile(fileName, null);
    }
  };

  useEffect(() => {
    const fileName = pendingPlayFileRef.current;
    if (!fileName || !currentFolder || !isFileStructureLoaded) {
      return;
    }
    pendingPlayFileRef.current = null;
    void openStreamForFile(fileName, null);
  }, [currentPath, currentFolder, isFileStructureLoaded, openStreamForFile]);

  const handleDownloadFile = async (fileName, e) => {
    e?.stopPropagation?.();

    try {
      if (!isConnected || !telegramClient) {
        setError('Not connected to Telegram. Please authenticate first.');
        return;
      }
      if (!selectedChatId) {
        setError('No chat group selected. Please select a chat group first.');
        return;
      }

      const folder = findFolderByPath(fileStructure, currentPath);
      if (!folder) {
        setError(`Folder not found: ${currentPath}`);
        return;
      }

      const fileEntry = folder.files.find((f) => f.filename === fileName);
      if (!fileEntry?.message_id) {
        setError(`No message ID for file: ${fileName}`);
        return;
      }

      setError(null);
      setSuccess(`Downloading ${fileName}…`);

      const resolved = await resolveTelegramFile(
        telegramClient,
        selectedChatId,
        fileName,
        fileEntry.message_id,
      );

      const mimeType = mimeTypeFromTelegramContent(resolved.message, fileName);
      await downloadTelegramFileWithStreaming(
        telegramClient,
        {
          fileId: resolved.fileId,
          size: resolved.size,
          fileName,
          mimeType,
          messageId: resolved.messageId,
          chatId: selectedChatId,
        },
        {
          onProgress: (pct) => setSuccess(`Downloading ${fileName}… ${pct}%`),
        },
      );

      setSuccess(`Downloaded ${fileName} successfully`);
    } catch (error) {
      console.error('Failed to download file:', error);
      setError(`Failed to download file: ${error.message}`);
    }
  };


  return (
    <div className="file-explorer" ref={explorerRootRef}>
      <div className="file-explorer-nav">
        <div className="breadcrumb">
          <span 
            className="breadcrumb-item" 
            onClick={() => handlePathClick(0)}
          >
            <FaHome style={{ marginRight: '5px' }} /> Home
          </span>
          
          {currentPath !== '/' && currentPath.split('/').filter(Boolean).map((segment, index) => (
            <span 
              key={index} 
              className="breadcrumb-item"
              onClick={() => handlePathClick(index + 1)}
            >
              {segment}
            </span>
          ))}
        </div>
      </div>
      
      <div 
        ref={explorerContentRef}
        className={`file-explorer-content ${isDragging ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDragEnd={handleDragEnd}
      >
        {error && (
          <div className="error-message">
            <FaTrash style={{ marginRight: '8px' }} />
            {error}
          </div>
        )}

        {success && (
          <div className="success-message">
            <FaCheck style={{ marginRight: '8px' }} />
            {success}
          </div>
        )}
        
        <div className="action-buttons">
          <button 
            className="upload-button" 
            onClick={() => fileInputRef.current.click()}
          >
            <FaUpload /> Upload Files
          </button>

          <button
            type="button"
            className="upload-button"
            onClick={() => folderInputRef.current?.click()}
            disabled={uploading}
          >
            <FaFolderPlus /> Upload Folder
          </button>

          <button
            type="button"
            className="upload-button"
            onClick={handleUploadFromUrl}
            disabled={uploading}
          >
            <FaLink /> Upload URL
          </button>
          
          <button 
            className="new-folder-button" 
            onClick={handleNewFolderClick}
          >
            <FaFolder /> New Folder
          </button>
          
          <UntrackedFilesToggle
            isPanelVisible={untrackedFilesState.isPanelVisible}
            count={untrackedFilesState.untrackedFiles.length}
            onToggle={untrackedFilesState.togglePanelVisibility}
          />

          {uploading && (
            <div className="upload-progress-panel" role="status" aria-live="polite">
              {uploadProgress ? (
                <>
                  <div className="upload-progress-label">
                    {uploadProgress.batchTotal
                      ? `(${uploadProgress.batchIndex}/${uploadProgress.batchTotal}) `
                      : ''}
                    {uploadProgress.fileName}
                    {' · '}
                    {Math.round((uploadProgress.ratio ?? 0) * 100)}%
                    {' · '}
                    {formatByteSize(uploadProgress.done)} / {formatByteSize(uploadProgress.total)}
                  </div>
                  <div className="upload-progress-track">
                    <div
                      className="upload-progress-fill"
                      style={{ width: `${Math.min(100, Math.round((uploadProgress.ratio ?? 0) * 100))}%` }}
                    />
                  </div>
                </>
              ) : (
                <div className="loading-indicator">
                  <div className="spinner"></div>
                  Preparing upload…
                </div>
              )}
            </div>
          )}
          
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={(e) => handleFiles(Array.from(e.target.files))}
            multiple
          />
          <input
            type="file"
            ref={folderInputRef}
            style={{ display: 'none' }}
            onChange={handleFolderSelect}
            webkitdirectory=""
            multiple
          />
        </div>

        <UntrackedFilesPanel
          slot="sheet"
          state={untrackedFilesState}
          currentPath={currentPath}
          onSuccess={setSuccess}
          onError={setError}
        />
        
        {currentPath !== '/' && (
          <div 
            className="parent-folder-drop-area"
            onClick={() => handlePathClick(currentPath.split('/').filter(Boolean).length - 1)}
            onDrop={(e) => handleFolderDrop(e)}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <FaArrowUp className="parent-folder-icon" />
            <span className="parent-folder-label">Go to parent folder</span>
          </div>
        )}
        
        <div className="file-grid">
          {currentFolder && currentFolder.subfolders && currentFolder.subfolders.length === 0 && 
           currentFolder.files && currentFolder.files.length === 0 ? (
            <div className={`empty-state ${isDragging ? 'drag-over' : ''}`}>
              <FaFolder style={{ fontSize: '48px', color: '#adb5bd', marginBottom: '16px' }} />
              <h3>This folder is empty</h3>
              <p>Drag and drop files here or use the upload button</p>
              <button 
                className="upload-button" 
                onClick={() => fileInputRef.current.click()}
              >
                <FaUpload /> Upload Files
              </button>
            </div>
          ) : (
            <>
              {gridItems.map((item, index) => {
                const keyboardSelected = showDesktopNavChrome && selectedIndex === index;

                if (item.type === 'folder') {
                  const folderName = item.name;
                  return (
                    <FolderGridItem
                      key={item.key}
                      itemRef={setItemRef(index)}
                      folderName={folderName}
                      currentPath={currentPath}
                      keyboardSelected={keyboardSelected}
                      onSelect={() => setSelectedIndex(index)}
                      onOpen={handleFolderClick}
                      onRename={handleRenameFolder}
                      onDelete={handleDeleteFolder}
                      onDragOver={(e) => handleFolderDragOver(e, folderName)}
                      onDragLeave={handleFolderDragLeave}
                      onDrop={(e) => handleFolderDrop(e, folderName)}
                    />
                  );
                }

                const file = currentFolder.files.find((f) => f.filename === item.name);
                if (!file) {
                  return null;
                }
                const isVideo = isVideoFileName(file.filename);
                const isStreamable = isStreamableMediaFileName(file.filename);
                return (
                  <FileGridItem
                    key={item.key}
                    itemRef={setItemRef(index)}
                    filename={file.filename}
                    currentPath={currentPath}
                    isVideo={isVideo}
                    isStreamable={isStreamable}
                    keyboardSelected={keyboardSelected}
                    onSelect={() => setSelectedIndex(index)}
                    onPlay={handleStreamPlay}
                    fileHref={
                      isStreamable
                        ? buildExplorerBrowserPathname(currentPath, file.filename)
                        : undefined
                    }
                    onDownload={handleDownloadFile}
                    onRename={handleRenameFile}
                    onDelete={handleDeleteFile}
                    icon={getFileIcon(file.filename)}
                    poster={
                      isVideo && file.message_id && selectedChatId ? (
                        <VideoPosterTile
                          telegramClient={telegramClient}
                          chatId={selectedChatId}
                          messageId={file.message_id}
                          fileName={file.filename}
                          interactive
                        />
                      ) : null
                    }
                  />
                );
              })}
            </>
          )}
        </div>
      </div>
      <VideoPlayerModal
        open={streamPlayer.open}
        title={streamPlayer.title}
        streamUrl={streamPlayer.url}
        audioOnly={streamPlayer.audioOnly}
        subtitleTrackUrl={streamPlayer.subtitleTrackUrl}
        preparePlayback={preparePlayback}
        onClose={() => {
          urlWriteModeRef.current = 'replace';
          if (streamPlayer.fileId != null) {
            unregisterPlaybackFileId(streamPlayer.fileId);
          }
          clearSidecarSubtitleBlob();
          setStreamPlayer({ ...CLOSED_STREAM_PLAYER });
        }}
      />
    </div>
  );
};

export default FileExplorer;