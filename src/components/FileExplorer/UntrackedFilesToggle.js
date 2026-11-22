import React from 'react';
import { FaEye, FaEyeSlash } from 'react-icons/fa';

const UntrackedFilesToggle = ({ isPanelVisible, count, onToggle }) => (
  <button
    type="button"
    className={`toggle-untracked-button ${isPanelVisible ? 'active' : ''}`}
    onClick={onToggle}
    title={isPanelVisible ? 'Hide untracked files' : 'Show untracked files in this chat'}
    aria-expanded={isPanelVisible}
  >
    {isPanelVisible ? <FaEyeSlash aria-hidden /> : <FaEye aria-hidden />}
    <span>Untracked Files</span>
    {count > 0 && <span className="toggle-untracked-badge">{count}</span>}
  </button>
);

export default UntrackedFilesToggle;