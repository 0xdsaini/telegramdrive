import { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import { TelegramContext } from '../../context/TelegramContext';
import {
  findFolderByPath,
  addFile,
  collectTrackedMessageIds,
} from '../../utils/fileStructureUtils';
import {
  buildUntrackedFileEntries,
  fetchUntrackedMediaBatch,
  appendMessagesById,
  UNTRACKED_SCAN_PAGE_SIZE,
  UNTRACKED_UI_PAGE_SIZE,
} from '../../utils/untrackedChatMedia';

export function useUntrackedFiles({ currentPath, onSuccess, onError }) {
  const [untrackedFiles, setUntrackedFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isPanelVisible, setIsPanelVisible] = useState(false);
  const [scannedMessageCount, setScannedMessageCount] = useState(0);
  const [hasMoreInChat, setHasMoreInChat] = useState(false);
  const [nextScanOffsetId, setNextScanOffsetId] = useState(0);
  const [messagesById, setMessagesById] = useState(() => new Map());
  const [displayPage, setDisplayPage] = useState(0);

  const {
    fileStructure,
    telegramClient,
    selectedChatId,
    isConnected,
  } = useContext(TelegramContext);

  const rebuildUntrackedFromScan = useCallback(
    (byId) => {
      const messages = [...byId.values()];
      const currentFolder = findFolderByPath(fileStructure, currentPath);
      const trackedFilenames = currentFolder
        ? currentFolder.files.map((file) => file.filename)
        : [];
      const trackedMessageIds = collectTrackedMessageIds(fileStructure);
      return buildUntrackedFileEntries(messages, trackedFilenames, trackedMessageIds);
    },
    [fileStructure, currentPath],
  );

  const applyScanResult = useCallback(
    (mergedById, hasMore, nextOffset) => {
      setMessagesById(mergedById);
      setScannedMessageCount(mergedById.size);
      setHasMoreInChat(hasMore);
      setNextScanOffsetId(nextOffset ?? 0);
      const untracked = rebuildUntrackedFromScan(mergedById);
      setUntrackedFiles(untracked);
      setSelectedFiles((prev) => prev.filter((id) => untracked.some((f) => f.messageId === id)));
      setDisplayPage(0);
    },
    [rebuildUntrackedFromScan],
  );

  const fetchScanBatch = useCallback(
    async (offsetMessageId, existingById) => {
      const { messages, hasMore, nextOffsetMessageId } = await fetchUntrackedMediaBatch(
        telegramClient,
        selectedChatId,
        {
          offsetMessageId,
          limit: UNTRACKED_SCAN_PAGE_SIZE,
        },
      );
      const merged = appendMessagesById(existingById, messages);
      return { merged, hasMore, nextOffsetMessageId };
    },
    [telegramClient, selectedChatId],
  );

  const scanForUntrackedFiles = useCallback(async ({ soft = false } = {}) => {
    if (!isConnected || !telegramClient) {
      onError('Not connected to Telegram. Please authenticate first.');
      return;
    }

    if (!selectedChatId) {
      onError('No chat group selected. Please select a chat group first.');
      return;
    }

    if (soft) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      const { merged, hasMore, nextOffsetMessageId } = await fetchScanBatch(0, new Map());
      applyScanResult(merged, hasMore, nextOffsetMessageId);
    } catch (error) {
      console.error('Error scanning for untracked files:', error);
      onError(`Error scanning for untracked files: ${error.message}`);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [
    isConnected,
    telegramClient,
    selectedChatId,
    onError,
    fetchScanBatch,
    applyScanResult,
  ]);

  const loadOlderInChat = useCallback(async () => {
    if (!hasMoreInChat || isLoadingOlder || !nextScanOffsetId) {
      return;
    }
    if (!telegramClient || !selectedChatId) {
      return;
    }

    setIsLoadingOlder(true);
    try {
      const { merged, hasMore, nextOffsetMessageId } = await fetchScanBatch(
        nextScanOffsetId,
        messagesById,
      );
      applyScanResult(merged, hasMore, nextOffsetMessageId);
    } catch (error) {
      console.error('Error loading older untracked scan page:', error);
      onError(`Error loading older messages: ${error.message}`);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [
    hasMoreInChat,
    isLoadingOlder,
    nextScanOffsetId,
    telegramClient,
    selectedChatId,
    fetchScanBatch,
    messagesById,
    applyScanResult,
    onError,
  ]);

  const displayPageCount = useMemo(
    () => Math.max(1, Math.ceil(untrackedFiles.length / UNTRACKED_UI_PAGE_SIZE)),
    [untrackedFiles.length],
  );

  const visibleFiles = useMemo(() => {
    const start = displayPage * UNTRACKED_UI_PAGE_SIZE;
    return untrackedFiles.slice(start, start + UNTRACKED_UI_PAGE_SIZE);
  }, [untrackedFiles, displayPage]);

  const goToDisplayPage = useCallback(
    (pageIndex) => {
      const maxIndex = displayPageCount - 1;
      setDisplayPage(Math.max(0, Math.min(pageIndex, maxIndex)));
    },
    [displayPageCount],
  );

  const toggleFileSelection = (messageId) => {
    setSelectedFiles((prev) => {
      if (prev.includes(messageId)) {
        return prev.filter((id) => id !== messageId);
      }
      return [...prev, messageId];
    });
  };

  const selectAll = () => {
    setSelectedFiles(untrackedFiles.map((f) => f.messageId));
  };

  const selectAllOnPage = () => {
    const pageIds = visibleFiles.map((f) => f.messageId);
    setSelectedFiles((prev) => {
      const merged = new Set(prev);
      pageIds.forEach((id) => merged.add(id));
      return [...merged];
    });
  };

  const clearSelection = () => {
    setSelectedFiles([]);
  };

  const addSelectedFilesToMetadata = async () => {
    if (selectedFiles.length === 0) {
      onError('No files selected');
      return;
    }

    try {
      let updatedStructure = { ...fileStructure };

      for (const messageId of selectedFiles) {
        const fileInfo = untrackedFiles.find((file) => file.messageId === messageId);
        if (fileInfo) {
          updatedStructure = addFile(
            updatedStructure,
            currentPath,
            fileInfo.filename,
            fileInfo.messageId,
          );
        }
      }

      const success = await window.updateTelegramFileStructure(updatedStructure, {
        saveIntent: 'upload',
      });

      if (success) {
        onSuccess(`Added ${selectedFiles.length} file(s) to tracking`);
        setUntrackedFiles((prev) => prev.filter((file) => !selectedFiles.includes(file.messageId)));
        setSelectedFiles([]);
      } else {
        onError('Failed to update file structure');
      }
    } catch (error) {
      console.error('Failed to add files to metadata:', error);
      onError(`Failed to add files to metadata: ${error.message}`);
    }
  };

  const togglePanelVisibility = () => {
    setIsPanelVisible((visible) => !visible);
  };

  useEffect(() => {
    if (!isPanelVisible) {
      return;
    }
    scanForUntrackedFiles({ soft: untrackedFiles.length > 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, isPanelVisible]);

  useEffect(() => {
    if (messagesById.size === 0) {
      return;
    }
    const untracked = rebuildUntrackedFromScan(messagesById);
    setUntrackedFiles(untracked);
    setSelectedFiles((prev) => prev.filter((id) => untracked.some((f) => f.messageId === id)));
  }, [fileStructure, currentPath, messagesById, rebuildUntrackedFromScan]);

  return {
    untrackedFiles,
    visibleFiles,
    selectedFiles,
    isLoading,
    isRefreshing,
    isLoadingOlder,
    isPanelVisible,
    scannedMessageCount,
    hasMoreInChat,
    displayPage,
    displayPageCount,
    telegramClient,
    selectedChatId,
    togglePanelVisibility,
    toggleFileSelection,
    selectAll,
    selectAllOnPage,
    clearSelection,
    addSelectedFilesToMetadata,
    loadOlderInChat,
    goToDisplayPage,
    refresh: () => scanForUntrackedFiles({ soft: untrackedFiles.length > 0 }),
  };
}