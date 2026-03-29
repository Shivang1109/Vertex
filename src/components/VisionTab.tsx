import { useState, useRef, useEffect, useCallback } from 'react';
import { ModelCategory, VideoCapture } from '@runanywhere/web';
import { VLMWorkerBridge } from '@runanywhere/web-llamacpp';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

const LIVE_INTERVAL_MS = 2500;
const LIVE_MAX_TOKENS = 30;
const SINGLE_MAX_TOKENS = 80;
const CAPTURE_DIM = 256;

interface VisionResult {
  text: string;
  totalMs: number;
}

export function VisionTab() {
  const loader = useModelLoader(ModelCategory.Multimodal);
  const [cameraActive, setCameraActive] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [result, setResult] = useState<VisionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('Describe what you see briefly.');

  const videoMountRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<VideoCapture | null>(null);
  const processingRef = useRef(false);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveModeRef = useRef(false);

  processingRef.current = processing;
  liveModeRef.current = liveMode;

  const startCamera = useCallback(async () => {
    if (captureRef.current?.isCapturing) return;
    setError(null);
    try {
      const cam = new VideoCapture({ facingMode: 'environment' });
      await cam.start();
      captureRef.current = cam;
      const mount = videoMountRef.current;
      if (mount) {
        const el = cam.videoElement;
        el.style.width = '100%';
        el.style.height = '100%';
        el.style.objectFit = 'cover';
        el.style.borderRadius = '10px';
        mount.appendChild(el);
      }
      setCameraActive(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NotAllowed') || msg.includes('Permission')) {
        setError('Camera permission denied. Check System Settings → Privacy & Security → Camera.');
      } else if (msg.includes('NotFound') || msg.includes('DevicesNotFound')) {
        setError('No camera found on this device.');
      } else if (msg.includes('NotReadable') || msg.includes('TrackStartError')) {
        setError('Camera is in use by another application.');
      } else {
        setError(`Camera error: ${msg}`);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (liveIntervalRef.current) clearInterval(liveIntervalRef.current);
      const cam = captureRef.current;
      if (cam) {
        cam.stop();
        cam.videoElement.parentNode?.removeChild(cam.videoElement);
        captureRef.current = null;
      }
    };
  }, []);

  const describeFrame = useCallback(async (maxTokens: number) => {
    if (processingRef.current) return;
    const cam = captureRef.current;
    if (!cam?.isCapturing) return;
    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }
    const frame = cam.captureFrame(CAPTURE_DIM);
    if (!frame) return;
    setProcessing(true);
    processingRef.current = true;
    setError(null);
    const t0 = performance.now();
    try {
      const bridge = VLMWorkerBridge.shared;
      if (!bridge.isModelLoaded) throw new Error('VLM model not loaded in worker');
      const res = await bridge.process(frame.rgbPixels, frame.width, frame.height, prompt, { maxTokens, temperature: 0.6 });
      setResult({ text: res.text, totalMs: performance.now() - t0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isWasmCrash = msg.includes('memory access out of bounds') || msg.includes('RuntimeError');
      if (isWasmCrash) {
        setResult({ text: 'Recovering from memory error... next frame will retry.', totalMs: 0 });
      } else {
        setError(msg);
        if (liveModeRef.current) stopLive();
      }
    } finally {
      setProcessing(false);
      processingRef.current = false;
    }
  }, [loader, prompt]);

  const describeSingle = useCallback(async () => {
    if (!captureRef.current?.isCapturing) { await startCamera(); return; }
    await describeFrame(SINGLE_MAX_TOKENS);
  }, [startCamera, describeFrame]);

  const startLive = useCallback(async () => {
    if (!captureRef.current?.isCapturing) await startCamera();
    setLiveMode(true);
    liveModeRef.current = true;
    describeFrame(LIVE_MAX_TOKENS);
    liveIntervalRef.current = setInterval(() => {
      if (!processingRef.current && liveModeRef.current) describeFrame(LIVE_MAX_TOKENS);
    }, LIVE_INTERVAL_MS);
  }, [startCamera, describeFrame]);

  const stopLive = useCallback(() => {
    setLiveMode(false);
    liveModeRef.current = false;
    if (liveIntervalRef.current) { clearInterval(liveIntervalRef.current); liveIntervalRef.current = null; }
  }, []);

  const toggleLive = useCallback(() => {
    liveMode ? stopLive() : startLive();
  }, [liveMode, startLive, stopLive]);

  return (
    <div className="tab-panel vision-panel">
      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="VLM"
      />

      {/* Camera area */}
      <div className="vision-camera">
        <div
          ref={videoMountRef}
          style={{
            flex: 1,
            background: cameraActive ? 'transparent' : 'var(--bg-2)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 0,
            position: 'relative',
          }}
        >
          {!cameraActive && (
            <div style={{ textAlign: 'center', padding: '32px 24px' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>📷</div>
              <p style={{ fontSize: '14px', fontWeight: '500', color: 'var(--text-2)', marginBottom: '6px' }}>
                Camera Preview
              </p>
              <p style={{ fontSize: '12px', color: 'var(--text-3)' }}>
                Start the camera to analyze images with AI
              </p>
            </div>
          )}
          {liveMode && (
            <div style={{
              position: 'absolute',
              top: '10px',
              left: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              background: 'rgba(239,68,68,0.9)',
              color: '#fff',
              fontSize: '11px',
              fontWeight: '600',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
              backdropFilter: 'blur(4px)',
            }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#fff', animation: 'pulse-soft 1s ease-in-out infinite', display: 'inline-block' }} />
              LIVE
            </div>
          )}
          {processing && !liveMode && (
            <div style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(248,250,252,0.7)',
              backdropFilter: 'blur(2px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--radius-lg)',
            }}>
              <div style={{ textAlign: 'center', gap: '10px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div className="spinner" />
                <span style={{ fontSize: '12px', color: 'var(--text-3)' }}>Analyzing...</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Prompt input */}
      <input
        className="vision-prompt"
        type="text"
        placeholder="What do you want to know about the image?"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={liveMode}
      />

      {/* Error */}
      {error && (
        <div style={{
          margin: '0 12px 8px',
          padding: '10px 14px',
          background: 'var(--red-dim)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 'var(--radius-md)',
          fontSize: '12px',
          color: 'var(--red-text)',
          lineHeight: '1.5',
        }}>
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="vision-result">
          <h4>
            {liveMode && <span className="live-badge" style={{ marginRight: '8px' }}>LIVE</span>}
            AI Description
            {result.totalMs > 0 && (
              <span style={{ float: 'right', fontSize: '10px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontWeight: '400' }}>
                {(result.totalMs / 1000).toFixed(1)}s
              </span>
            )}
          </h4>
          <p>{result.text}</p>
        </div>
      )}

      {/* Actions */}
      <div className="vision-actions">
        {!cameraActive ? (
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={startCamera}>
            📷 Start Camera
          </button>
        ) : (
          <>
            <button
              className="btn btn-primary"
              style={{ flex: 1 }}
              onClick={describeSingle}
              disabled={processing || liveMode}
            >
              {processing && !liveMode ? (
                <><span className="spinner" style={{ width: '12px', height: '12px', borderWidth: '1.5px', borderTopColor: '#fff' }} /> Analyzing...</>
              ) : '🔍 Describe'}
            </button>
            <button
              className={`btn ${liveMode ? 'btn-live-active' : ''}`}
              onClick={toggleLive}
              disabled={processing && !liveMode}
            >
              {liveMode ? '⏹ Stop Live' : '▶ Live'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
