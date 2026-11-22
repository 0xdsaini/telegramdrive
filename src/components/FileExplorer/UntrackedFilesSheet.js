import React from 'react';
import { FaFileAlt, FaCheck, FaPlus } from 'react-icons/fa';
import VideoPosterTile from './VideoPosterTile';
import { isVideoFileName } from '../../utils/mimeTypes';

function formatSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function SkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((i) => (
        <div key={i} className="untracked-file-item untracked-file-item--skeleton" aria-hidden>
          <div className="untracked-row-check" />
          <div className="untracked-row-thumb skeleton-block" />
          <div className="untracked-row-text">
            <div className="skeleton-line skeleton-line--title" />
            <div className="skeleton-line skeleton-line--meta" />
          </div>
        </div>
      ))}
    </>
  );
}

const UntrackedFilesSheet = ({
  untrackedFiles,
  selectedFiles,
  isLoading,
  isRefreshing,
  telegramClient,
  selectedChatId,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onRefresh,
  onImport,
}) => {
  const showInitialSkeleton = isLoading && untrackedFiles.length === 0;
  const allSelected =
    untrackedFiles.length > 0 && selectedFiles.length === untrackedFiles.length;

  return (
    <section className="untracked-files-sheet" aria-label="Untracked files in Telegram chat">
      <header className="untracked-files-header">
        <div className="untracked-files-header-text">
          <h3>Untracked Files</h3>
          <p className="untracked-files-subtitle">
            Videos found in this group that are not in the current folder.
            {isRefreshing && <span className="untracked-refreshing-label"> Refreshing…</span>}
          </p>
        </div>
        <div className="untracked-actions">
          <button
            type="button"
            className="untracked-text-button"
            onClick={allSelected ? onClearSelection : onSelectAll}
            disabled={untrackedFiles.length === 0 || showInitialSkeleton}
          >
            {allSelected ? 'Clear' : 'Select all'}
          </button>
          <button
            type="button"
            className="untracked-files-refresh-button"
            onClick={onRefresh}
            disabled={isLoading && !isRefreshing}
          >
            Refresh
          </button>
          <button
            type="button"
            className="add-selected-button"
            onClick={onImport}
            disabled={selectedFiles.length === 0 || isLoading}
          >
            <FaPlus aria-hidden />
            Import{selectedFiles.length > 0 ? ` (${selectedFiles.length})` : ''}
          </button>
        </div>
      </header>

      <div
        className={`untracked-files-list ${showInitialSkeleton ? 'untracked-files-list--loading' : ''}`}
      >
        {showInitialSkeleton ? (
          <SkeletonRows />
        ) : untrackedFiles.length === 0 ? (
          <div className="no-files-message">
            Nothing orphaned here — all chat videos in this scan are already tracked in this folder.
          </div>
        ) : (
          untrackedFiles.map((file) => {
            const selected = selectedFiles.includes(file.messageId);
            const isVideo = file.mediaType === 'video' || isVideoFileName(file.filename);
            return (
              <div
                key={file.messageId}
                className={`untracked-file-item ${selected ? 'selected' : ''}`}
                onClick={() => onToggleSelect(file.messageId)}
                role="checkbox"
                aria-checked={selected}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggleSelect(file.messageId);
                  }
                }}
              >
                <span className={`untracked-row-check ${selected ? 'is-checked' : ''}`}>
                  {selected && <FaCheck aria-hidden />}
                </span>
                <div className="untracked-row-thumb">
                  {isVideo && telegramClient && selectedChatId ? (
                    <VideoPosterTile
                      telegramClient={telegramClient}
                      chatId={selectedChatId}
                      messageId={file.messageId}
                      fileName={file.filename}
                      compact
                    />
                  ) : (
                    <span className="untracked-row-thumb-icon">
                      <FaFileAlt aria-hidden />
                    </span>
                  )}
                </div>
                <div className="untracked-row-text">
                  <span className="untracked-file-title" title={file.filename}>
                    {file.filename}
                  </span>
                  <span className="untracked-file-meta">
                    {formatSize(file.size)} · {file.date}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
};

export default UntrackedFilesSheet;