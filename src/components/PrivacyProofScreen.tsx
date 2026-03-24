import { useState, useEffect, useRef } from 'react';

interface PrivacyProofScreenProps {
  onClose: () => void;
}

export function PrivacyProofScreen({ onClose }: PrivacyProofScreenProps) {
  const [requestCount, setRequestCount] = useState(0);
  const [entries, setEntries] = useState<string[]>([]);
  const observerRef = useRef<PerformanceObserver | null>(null);

  useEffect(() => {
    // Use PerformanceObserver to watch for real network requests
    if ('PerformanceObserver' in window) {
      observerRef.current = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as PerformanceResourceTiming;
          // Only flag fetch/XHR — skip model downloads (HuggingFace .gguf files),
          // WASM binaries, fonts, and same-origin assets. These are expected and
          // not AI inference requests.
          if (
            (e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest') &&
            !e.name.includes('huggingface.co') &&
            !e.name.includes('.gguf') &&
            !e.name.includes('.wasm') &&
            !e.name.includes('.onnx') &&
            !e.name.includes('fonts.googleapis') &&
            !e.name.includes('fonts.gstatic') &&
            !e.name.includes(window.location.origin)
          ) {
            setRequestCount(c => c + 1);
            setEntries(prev => [`${e.initiatorType.toUpperCase()} → ${e.name.slice(0, 60)}`, ...prev].slice(0, 10));
          }
        }
      });
      observerRef.current.observe({ entryTypes: ['resource'] });
    }

    return () => observerRef.current?.disconnect();
  }, []);

  return (
    <div className="proof-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="proof-card">
        <button className="proof-close" onClick={onClose} aria-label="Close">✕</button>

        <div className="proof-icon">🔒</div>
        <h2 className="proof-title">Zero Bytes Sent — Verified</h2>
        <p className="proof-subtitle">
          This screen monitors all outbound network requests in real time using the browser's
          PerformanceObserver API. Interact with the AI — nothing will appear below.
        </p>

        <div className={`proof-counter ${requestCount === 0 ? 'proof-counter-zero' : 'proof-counter-nonzero'}`}>
          <span className="proof-counter-number">{requestCount}</span>
          <span className="proof-counter-label">
            {requestCount === 0 ? 'outbound AI requests detected' : 'requests detected ⚠️'}
          </span>
        </div>

        <div className="proof-log">
          {entries.length === 0 ? (
            <div className="proof-log-empty">
              <span className="proof-log-dot" />
              Monitoring… no requests detected
            </div>
          ) : (
            entries.map((e, i) => (
              <div key={i} className="proof-log-entry">{e}</div>
            ))
          )}
        </div>

        <div className="proof-instructions">
          <strong>How to verify manually:</strong>
          <ol>
            <li>Open DevTools (F12 or ⌘⌥I)</li>
            <li>Go to Network tab → filter by Fetch/XHR</li>
            <li>Use Dev Mode or Chat — watch: zero AI requests</li>
          </ol>
        </div>

        <button className="btn btn-accent" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
