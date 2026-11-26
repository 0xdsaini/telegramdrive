import React from 'react';
import { useUntrackedFiles } from './useUntrackedFiles';
import UntrackedFilesToggle from './UntrackedFilesToggle';
import UntrackedFilesSheet from './UntrackedFilesSheet';
import './FileExplorer.css';

const UntrackedFilesPanel = ({ currentPath, onSuccess, onError, slot = 'toggle', state: externalState }) => {
  const internalState = useUntrackedFiles({ currentPath, onSuccess, onError });
  const state = externalState || internalState;

  if (slot === 'sheet') {
    if (!state.isPanelVisible) {
      return null;
    }
    return (
      <UntrackedFilesSheet
        visibleFiles={state.visibleFiles}
        untrackedFiles={state.untrackedFiles}
        selectedFiles={state.selectedFiles}
        isLoading={state.isLoading}
        isRefreshing={state.isRefreshing}
        isLoadingOlder={state.isLoadingOlder}
        scannedMessageCount={state.scannedMessageCount}
        hasMoreInChat={state.hasMoreInChat}
        displayPage={state.displayPage}
        displayPageCount={state.displayPageCount}
        telegramClient={state.telegramClient}
        selectedChatId={state.selectedChatId}
        onToggleSelect={state.toggleFileSelection}
        onSelectAllOnPage={state.selectAllOnPage}
        onClearSelection={state.clearSelection}
        onRefresh={state.refresh}
        onImport={state.addSelectedFilesToMetadata}
        onLoadOlderInChat={state.loadOlderInChat}
        onDisplayPageChange={state.goToDisplayPage}
      />
    );
  }

  if (externalState) {
    return null;
  }

  return (
    <UntrackedFilesToggle
      isPanelVisible={state.isPanelVisible}
      count={state.untrackedFiles.length}
      onToggle={state.togglePanelVisibility}
    />
  );
};

export default UntrackedFilesPanel;
export { useUntrackedFiles };