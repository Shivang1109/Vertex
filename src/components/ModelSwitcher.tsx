import { useState, useEffect } from 'react';
import { ModelManager, ModelCategory } from '@runanywhere/web';

interface ModelOption {
  id: string;
  name: string;
  size: string;
  description: string;
}

const LLM_MODELS: ModelOption[] = [
  {
    id: 'lfm2-350m-q4_k_m',
    name: 'LFM2 350M',
    size: '~250MB',
    description: 'Fast · Good for quick tasks',
  },
  {
    id: 'lfm2-1.2b-tool-q4_k_m',
    name: 'LFM2 1.2B Tool',
    size: '~800MB',
    description: 'Smarter · Better code & reasoning',
  },
];

interface ModelSwitcherProps {
  /** Called when user picks a different model — parent should reload */
  onModelChange?: (modelId: string) => void;
}

export function ModelSwitcher({ onModelChange }: ModelSwitcherProps) {
  const [activeId, setActiveId] = useState<string>(() => {
    return localStorage.getItem('privateide_model') || 'lfm2-350m-q4_k_m';
  });
  const [open, setOpen] = useState(false);

  // Sync with whatever is actually loaded
  useEffect(() => {
    const loaded = ModelManager.getLoadedModel(ModelCategory.Language);
    if (loaded) setActiveId(loaded.id);
  }, []);

  const active = LLM_MODELS.find(m => m.id === activeId) ?? LLM_MODELS[0];

  const handleSelect = (model: ModelOption) => {
    if (model.id === activeId) { setOpen(false); return; }

    // Warn before downloading the large model
    if (model.id === 'lfm2-1.2b-tool-q4_k_m') {
      const confirmed = window.confirm(
        `"${model.name}" requires ~800MB of storage and bandwidth.\n\nThis will download once and cache in your browser.\n\nContinue?`
      );
      if (!confirmed) { setOpen(false); return; }
    }

    localStorage.setItem('privateide_model', model.id);
    setActiveId(model.id);
    setOpen(false);
    onModelChange?.(model.id);
  };

  return (
    <div className="model-switcher" style={{ position: 'relative' }}>
      <button
        className="model-switcher-btn"
        onClick={() => setOpen(v => !v)}
        title="Switch model"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="model-switcher-name">{active.name}</span>
        <span className="model-switcher-size">{active.size}</span>
        <span className="model-switcher-caret">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <>
          {/* backdrop */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setOpen(false)}
          />
          <div className="model-switcher-dropdown" role="listbox">
            {LLM_MODELS.map(m => (
              <button
                key={m.id}
                className={`model-switcher-option ${m.id === activeId ? 'active' : ''}`}
                onClick={() => handleSelect(m)}
                role="option"
                aria-selected={m.id === activeId}
              >
                <div className="model-option-top">
                  <span className="model-option-name">{m.name}</span>
                  <span className="model-option-size">{m.size}</span>
                </div>
                <span className="model-option-desc">{m.description}</span>
                {m.id === activeId && <span className="model-option-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
