import { useKeyboardShortcuts } from '../context/KeyboardShortcutsContext';

interface ShortcutRow {
  action: string;
  keys: string[];
}

export function ShortcutsModal() {
  const { showShortcutsModal, setShowShortcutsModal, modKey } = useKeyboardShortcuts();

  if (!showShortcutsModal) return null;

  const globalShortcuts: ShortcutRow[] = [
    { action: 'Show keyboard shortcuts', keys: ['?'] },
    { action: 'Switch to Dev Mode', keys: [modKey, '1'] },
    { action: 'Switch to Research Mode', keys: [modKey, '2'] },
    { action: 'Switch to Chat', keys: [modKey, '3'] },
  ];

  const devModeShortcuts: ShortcutRow[] = [
    { action: 'Explain code', keys: [modKey, 'E'] },
    { action: 'Generate docstring', keys: [modKey, 'D'] },
    { action: 'Debug code', keys: [modKey, 'G'] },
    { action: 'Refactor code', keys: [modKey, 'Shift', 'R'] },
    { action: 'Retry last action', keys: [modKey, 'R'] },
    { action: 'Clear output panel', keys: [modKey, 'L'] },
    { action: 'Focus editor', keys: [modKey, 'K'] },
  ];

  const researchModeShortcuts: ShortcutRow[] = [
    { action: 'Open PDF file picker', keys: [modKey, 'U'] },
    { action: 'Submit question', keys: [modKey, 'Enter'] },
    { action: 'Generate outline', keys: [modKey, 'Shift', 'O'] },
    { action: 'Format citations', keys: [modKey, 'Shift', 'C'] },
    { action: 'Retry last action', keys: [modKey, 'R'] },
  ];

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setShowShortcutsModal(false);
    }
  };

  const renderShortcut = (shortcut: ShortcutRow) => (
    <div key={shortcut.action} className="shortcut-row">
      <span className="shortcut-action">{shortcut.action}</span>
      <div className="shortcut-keys">
        {shortcut.keys.map((key, idx) => (
          <span key={idx}>
            <kbd>{key}</kbd>
            {idx < shortcut.keys.length - 1 && <span className="shortcut-plus">+</span>}
          </span>
        ))}
      </div>
    </div>
  );

  return (
    <div className="shortcuts-modal-overlay" onClick={handleBackdropClick}>
      <div className="shortcuts-modal">
        <h2 style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          Keyboard Shortcuts
          <button
            className="btn btn-sm"
            onClick={() => setShowShortcutsModal(false)}
            aria-label="Close shortcuts modal"
          >
            ✕
          </button>
        </h2>

        <div className="shortcuts-modal-body">
          <div className="shortcut-category">Global</div>
          {globalShortcuts.map(renderShortcut)}

          <div className="shortcut-category">Dev Mode</div>
          {devModeShortcuts.map(renderShortcut)}

          <div className="shortcut-category">Research Mode</div>
          {researchModeShortcuts.map(renderShortcut)}
        </div>
      </div>
    </div>
  );
}
