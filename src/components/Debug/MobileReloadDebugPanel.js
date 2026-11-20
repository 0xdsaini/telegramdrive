import React, { useCallback, useEffect, useState } from 'react';
import { isAppDebugEnabled } from '../../utils/appDebug';
import {
  buildDebugReport,
  clearDebugPersistence,
  copyDebugReport,
  isDebugPanelForced,
  recordDebugEvent,
} from '../../utils/reloadDebug';
import './MobileReloadDebugPanel.css';

const isCoarsePointer =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches;

const MobileReloadDebugPanel = () => {
  const [open, setOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [copyHint, setCopyHint] = useState('');
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(isDebugPanelForced() || isCoarsePointer);
  }, []);

  const refreshReport = useCallback(async () => {
    const text = await buildDebugReport();
    setReportText(text);
    return text;
  }, []);

  const handleOpen = async () => {
    setOpen(true);
    setCopyHint('');
    await refreshReport();
    recordDebugEvent('debug_panel_open', {});
  };

  const handleCopy = async () => {
    const result = await copyDebugReport();
    if (result.ok) {
      setCopyHint('Copied — paste into chat.');
    } else {
      setCopyHint('Select all text below, then Copy.');
    }
    setReportText(result.text);
  };

  const handleClear = () => {
    if (!window.confirm('Clear stored reload debug data?')) return;
    clearDebugPersistence();
    setReportText('');
    setCopyHint('Cleared. Reload once, then reproduce the bug and copy again.');
    recordDebugEvent('debug_cleared', {});
  };

  if (!visible) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className="mobile-reload-debug-fab"
        onClick={handleOpen}
        aria-label="Reload debug"
      >
        Dbg
      </button>

      {open && (
        <div className="mobile-reload-debug-overlay" role="dialog" aria-modal="true">
          <div className="mobile-reload-debug-sheet">
            <h2 className="mobile-reload-debug-title">Reload debug</h2>
            <p className="mobile-reload-debug-hint">
              Verbose stream/TDLib logs: add <code>?debug=1</code> (use{' '}
              <code>?debug=0</code> to turn off). Reload issues:{' '}
              <code>?debugReload=1&amp;noSwReload=1</code>. Debug mode is{' '}
              {isAppDebugEnabled() ? 'ON' : 'OFF'}.
            </p>
            <div className="mobile-reload-debug-actions">
              <button type="button" onClick={handleCopy}>
                Copy report
              </button>
              <button type="button" onClick={() => refreshReport()}>
                Refresh
              </button>
              <button type="button" onClick={handleClear}>
                Clear data
              </button>
              <button type="button" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            {copyHint && <p className="mobile-reload-debug-copy-hint">{copyHint}</p>}
            <textarea
              className="mobile-reload-debug-textarea"
              readOnly
              value={reportText}
              onFocus={(e) => e.target.select()}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default MobileReloadDebugPanel;