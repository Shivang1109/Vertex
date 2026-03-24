import { useEffect, useCallback } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { useModelLoader, type LoaderState } from './useModelLoader';
import { useDownloadOverlay } from '../context/DownloadOverlayContext';
import { useModel } from '../context/ModelContext';
import { ModelManager } from '@runanywhere/web';

export type { LoaderState };

interface ModelLoaderResult {
  state: LoaderState;
  progress: number;
  error: string | null;
  ensure: () => Promise<boolean>;
}

/**
 * Composes useModelLoader with the cinematic download overlay.
 * Delegates all model logic to the base hook; only adds overlay side-effects.
 */
export function useModelLoaderWithOverlay(category: ModelCategory, coexist = false): ModelLoaderResult {
  const base = useModelLoader(category, coexist);
  const { showOverlay, updateProgress, hideOverlay } = useDownloadOverlay();
  const { setModelLoaded } = useModel();

  // Mirror download progress into the overlay
  useEffect(() => {
    if (base.state === 'downloading') {
      updateProgress(base.progress * 100);
    }
  }, [base.progress, base.state, updateProgress]);

  // Show overlay when download starts, hide when done or errored
  useEffect(() => {
    if (base.state === 'downloading') {
      const models = ModelManager.getModels().filter((m) => m.modality === category);
      const model = models[0];
      const sizeInMB = model?.sizeBytes ? Math.round(model.sizeBytes / 1024 / 1024) : 234;
      const displayName = model?.id.includes('350M') ? 'LFM2 350M'
        : model?.id.includes('1.5B') ? 'LFM2 1.5B'
        : 'LFM2 350M';
      showOverlay(displayName, `${sizeInMB} MB`);
    }
    if (base.state === 'ready') {
      setModelLoaded(true);
      setTimeout(hideOverlay, 2500);
    }
    if (base.state === 'error') {
      hideOverlay();
    }
  }, [base.state, category, showOverlay, hideOverlay, setModelLoaded]);

  // Wrap ensure to trigger overlay on first call
  const ensure = useCallback(async (): Promise<boolean> => {
    return base.ensure();
  }, [base.ensure]);

  return { ...base, ensure };
}
