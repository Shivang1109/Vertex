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

export function ChatTab() {
  const loader = useModelLoaderWithOverlay(ModelCategory.Language);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { incrementTokens } = usePrivacyMonitor();
  const { setInferenceActive, resetInference } = useModel();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || generating) return;

    if (loader.state !== 'ready') {
      const ok = await loader.ensure();
      if (!ok) return;
    }

    setInput('');
    const nextMessages: Message[] = [...messages, { role: 'user', text }];
    setMessages(nextMessages);
    setGenerating(true);
    setInferenceActive(true);
    resetInference();

    const assistantIdx = nextMessages.length;
    setMessages(prev => [...prev, { role: 'assistant', text: '' }]);

    try {
      // Build rolling context from last 6 exchanges (3 user + 3 assistant)
      const contextWindow = nextMessages.slice(-6);
      const contextPrompt = contextWindow
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`)
        .join('\n');
      const fullPrompt = `${contextPrompt}\nAssistant:`;

      const { stream, result: resultPromise, cancel } = await TextGeneration.generateStream(fullPrompt, {
        maxTokens: 512,
        temperature: 0.7,
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

  const handleCancel = () => {
    cancelRef.current?.();
  };

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
      '*Exported from [PrivateIDE](https://github.com)*',
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
            <span style={{ fontSize: '48px', marginBottom: '16px' }}>💬</span>
            <h3>Your Private AI Assistant</h3>
            <p>Start chatting with a fully local AI model. Your conversations never leave your device.</p>
            <p style={{ 
              fontSize: '12px', 
              marginTop: '16px',
              color: 'var(--green-light)',
              fontWeight: '600'
            }}>
              🔒 100% Private • ⚡ Fast • 🌐 Offline-Ready
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`message message-${msg.role}`}>
            <div className="message-bubble">
              <p>{msg.text || <span style={{ opacity: 0.5 }}>Thinking...</span>}</p>
              {msg.stats && (
                <div className="message-stats">
                  ⚡ {msg.stats.tokens} tokens • {msg.stats.tokPerSec.toFixed(1)} tok/s • ⏱️ {msg.stats.latencyMs.toFixed(0)}ms
                </div>
              )}
            </div>
          </div>
        ))}
        {generating && (
          <div className="message message-assistant">
            <div className="message-bubble" style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px',
              minHeight: '44px'
            }}>
              <span className="cursor-blink">|</span>
            </div>
          </div>
        )}
      </div>

      <form
        className="chat-input"
        onSubmit={(e) => { e.preventDefault(); send(); }}
      >
        <input
          type="text"
          placeholder="Type your message... (Press Enter to send)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={generating}
          autoFocus
        />
        {messages.length > 0 && !generating && (
          <>
            <button type="button" className="btn btn-sm" onClick={handleExportChat} title="Export chat as Markdown">
              ⬇️
            </button>
            <button type="button" className="btn btn-sm" onClick={handleClearChat} title="Clear conversation">
              🗑
            </button>
          </>
        )}
        {generating ? (
          <button type="button" className="btn btn-danger" onClick={handleCancel}>
            ⏹️ Stop
          </button>
        ) : (
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!input.trim()}
            title="Send message (Enter)"
          >
            ⬆️ Send
          </button>
        )}
      </form>
    </div>
  );
}
