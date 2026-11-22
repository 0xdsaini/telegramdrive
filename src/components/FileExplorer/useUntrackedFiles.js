import { useState, useEffect, useCallback, useContext } from 'react';
import { TelegramContext } from '../../context/TelegramContext';
import {
  findFolderByPath,
  addFile,
  collectTrackedMessageIds,
} from '../../utils/fileStructureUtils';
import { buildUntrackedFileEntries, mergeChatMediaMessages } from '../../utils/untrackedChatMedia';

export function useUntrackedFiles({ currentPath, onSuccess, onError }) {
  const [untrackedFiles, setUntrackedFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPanelVisible, setIsPanelVisible] = useState(false);

  const {
    fileStructure,
    telegramClient,
    selectedChatId,
    isConnected,
  } = useContext(TelegramContext);

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
      const [documentResult, videoResult] = await Promise.all([
        telegramClient.send({
          '@type': 'searchChatMessages',
          chat_id: selectedChatId,
          filter: { '@type': 'searchMessagesFilterDocument' },
          limit: 100,
        }),
        telegramClient.send({
          '@type': 'searchChatMessages',
          chat_id: selectedChatId,
          filter: { '@type': 'searchMessagesFilterVideo' },
          limit: 100,
        }),
      ]);

      const messages = mergeChatMediaMessages(documentResult, videoResult);
      const currentFolder = findFolderByPath(fileStructure, currentPath);
      const trackedFilenames = currentFolder
        ? currentFolder.files.map((file) => file.filename)
        : [];
      const trackedMessageIds = collectTrackedMessageIds(fileStructure);
      const untracked = buildUntrackedFileEntries(
        messages,
        trackedFilenames,
        trackedMessageIds,
      );

      setUntrackedFiles(untracked);
      setSelectedFiles((prev) => prev.filter((id) => untracked.some((f) => f.messageId === id)));
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
    fileStructure,
    currentPath,
    onError,
  ]);

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

      const success = await window.updateTelegramFileStructure(updatedStructure);

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

  return {
    untrackedFiles,
    selectedFiles,
    isLoading,
    isRefreshing,
    isPanelVisible,
    telegramClient,
    selectedChatId,
    togglePanelVisibility,
    toggleFileSelection,
    selectAll,
    clearSelection,
    addSelectedFilesToMetadata,
    refresh: () => scanForUntrackedFiles({ soft: untrackedFiles.length > 0 }),
  };
}