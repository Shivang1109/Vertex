import { useState, useRef, useEffect, useCallback } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoaderWithOverlay } from '../hooks/useModelLoaderWithOverlay';
import { ModelBanner } from './ModelBanner';
import { usePrivacyMonitor } from '../context/PrivacyMonitorContext';
import { useModel } from '../context/ModelContext';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  stats?: { tokens: number; tokPerSec: number; latencyMs: number };
}

const SUGGESTIONS = [
  'Explain async/await in JavaScript',
  'What is a binary search tree?',
  'Write a Python function to reverse a string',
  'What are the SOLID principles?',
];

export function ChatTab() {
  const loader = useModelLoaderWithOverlay(ModelCategory.Language);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { incrementTokens } = usePrivacyMonitor();
  const { setInferenceActive, resetInference } = useModel();

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || generating) return;

    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }

    setInput('');
    const nextMessages: Message[] = [...messages, { role: 'user', text: msg }];
    setMessages(nextMessages);
    setGenerating(true);
    setInferenceActive(true);
    resetInference();

    const assistantIdx = nextMessages.length;
    setMessages(prev => [...prev, { role: 'assistant', text: '' }]);

    try {
      const contextWindow = nextMessages.slice(-4);
      const contextPrompt = contextWindow
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
        .join('\n');
      const fullPrompt = `${contextPrompt}\nAssistant:`;

      const { stream, result: resultPromise, cancel } = await TextGeneration.generateStream(fullPrompt, {
        maxTokens: 200,
        temperature: 0.7,
        topP: 0.9,
      });
      cancelRef.current = cancel;

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
        incrementTokens(1);
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = { role: 'assistant', text: accumulated };
          return updated;
        });
      }

      const result = await resultPromise;
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = {
          role: 'assistant',
          text: result.text || accumulated,
          stats: {
            tokens: result.tokensUsed,
            tokPerSec: result.tokensPerSecond,
            latencyMs: result.latencyMs,
          },
        };
        return updated;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(prev => {
        const updated = [...prev];
        updated[assistantIdx] = { role: 'assistant', text: `Error: ${msg}` };
        return updated;
      });
    } finally {
      cancelRef.current = null;
      setGenerating(false);
      setInferenceActive(false);
    }
  }, [input, generating, messages, loader, incrementTokens, setInferenceActive, resetInference]);

  const handleCancel = () => cancelRef.current?.();
  const handleClearChat = () => setMessages([]);

  const handleExportChat = () => {
    if (messages.length === 0) return;
    const md = [
      '# PrivateIDE Chat Session',
      '> 100% on-device conversation. Zero bytes sent to cloud.',
      '',
      ...messages.map(m => `**${m.role === 'user' ? 'You' : 'AI'}:** ${m.text}`),
      '',
      '---',
      '*Exported from PrivateIDE*',
    ].join('\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="tab-panel chat-panel">
      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="LLM"
      />

      <div className="message-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="empty-state">
            <div style={{ fontSize: '40px', marginBottom: '4px' }}>💬</div>
            <h3>Private AI Chat</h3>
            <p>Your conversations run entirely on-device. Nothing leaves your browser.</p>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              marginTop: '4px',
              fontSize: '11px',
              fontWeight: '600',
              color: 'var(--green-text)',
              background: 'var(--green-dim)',
              border: '1px solid rgba(34,197,94,0.2)',
              borderRadius: 'var(--radius-2xl)',
              padding: '4px 12px',
            }}>
              <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />
              100% Private · Offline-Ready
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '16px', justifyContent: 'center', maxWidth: '320px' }}>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  className="btn btn-sm"
                  style={{ fontSize: '12px', textAlign: 'left' }}
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-bubble">
              {msg.text
                ? <span>{msg.text}</span>
                : <span style={{ opacity: 0.5, fontStyle: 'italic' }}>Thinking...</span>
              }
              {msg.stats && (
                <div className="message-stats">
                  ⚡ {msg.stats.tokens} tokens · {msg.stats.tokPerSec.toFixed(1)} tok/s · {msg.stats.latencyMs.toFixed(0)}ms
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input
          ref={inputRef}
          type="text"
          placeholder="Ask anything... (Enter to send)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={generating}
          autoFocus
        />
        {messages.length > 0 && !generating && (
          <>
            <button type="button" className="btn btn-sm" onClick={handleExportChat} title="Export as Markdown">⬇️</button>
            <button type="button" className="btn btn-sm" onClick={handleClearChat} title="Clear chat">🗑</button>
          </>
        )}
        {generating ? (
          <button type="button" className="btn btn-danger" onClick={handleCancel}>⏹ Stop</button>
        ) : (
          <button type="submit" className="btn btn-primary" disabled={!input.trim()}>Send ↑</button>
        )}
      </form>
    </div>
  );
}
