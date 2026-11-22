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
        untrackedFiles={state.untrackedFiles}
        selectedFiles={state.selectedFiles}
        isLoading={state.isLoading}
        isRefreshing={state.isRefreshing}
        telegramClient={state.telegramClient}
        selectedChatId={state.selectedChatId}
        onToggleSelect={state.toggleFileSelection}
        onSelectAll={state.selectAll}
        onClearSelection={state.clearSelection}
        onRefresh={state.refresh}
        onImport={state.addSelectedFilesToMetadata}
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