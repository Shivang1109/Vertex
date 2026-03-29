import { useState, useRef, useCallback, useEffect } from 'react';
import { VoicePipeline, ModelCategory, ModelManager, AudioCapture, AudioPlayback, SpeechActivity } from '@runanywhere/web';
import { VAD } from '@runanywhere/web-onnx';
import { useModelLoader } from '../hooks/useModelLoader';
import { ModelBanner } from './ModelBanner';

type VoiceState = 'idle' | 'loading-models' | 'listening' | 'processing' | 'speaking';

const STATE_CONFIG: Record<VoiceState, { icon: string; label: string; color: string }> = {
  idle:           { icon: '🎙️', label: 'Tap to start listening',  color: 'var(--text-3)' },
  'loading-models': { icon: '⏳', label: 'Loading models...',      color: 'var(--purple-text)' },
  listening:      { icon: '👂', label: 'Listening... speak now',  color: 'var(--accent-text)' },
  processing:     { icon: '🧠', label: 'Processing speech...',    color: 'var(--amber-text)' },
  speaking:       { icon: '🔊', label: 'Speaking...',             color: 'var(--green-text)' },
};

export function VoiceTab() {
  const llmLoader = useModelLoader(ModelCategory.Language, true);
  const sttLoader = useModelLoader(ModelCategory.SpeechRecognition, true);
  const ttsLoader = useModelLoader(ModelCategory.SpeechSynthesis, true);
  const vadLoader = useModelLoader(ModelCategory.Audio, true);

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const micRef = useRef<AudioCapture | null>(null);
  const pipelineRef = useRef<VoicePipeline | null>(null);
  const vadUnsub = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      micRef.current?.stop();
      vadUnsub.current?.();
    };
  }, []);

  const ensureModels = useCallback(async (): Promise<boolean> => {
    setVoiceState('loading-models');
    setError(null);
    const results = await Promise.all([
      vadLoader.ensure(),
      sttLoader.ensure(),
      llmLoader.ensure(),
      ttsLoader.ensure(),
    ]);
    if (results.every(Boolean)) { setVoiceState('idle'); return true; }
    setError('Failed to load one or more voice models');
    setVoiceState('idle');
    return false;
  }, [vadLoader, sttLoader, llmLoader, ttsLoader]);

  const processSpeech = useCallback(async (audioData: Float32Array) => {
    const pipeline = pipelineRef.current;
    if (!pipeline) return;
    micRef.current?.stop();
    vadUnsub.current?.();
    setVoiceState('processing');
    try {
      const result = await pipeline.processTurn(audioData, {
        maxTokens: 60,
        temperature: 0.7,
        systemPrompt: 'You are a helpful voice assistant. Keep responses concise — 1-2 sentences max.',
      }, {
        onTranscription: (text) => setTranscript(text),
        onResponseToken: (_token, accumulated) => setResponse(accumulated),
        onResponseComplete: (text) => setResponse(text),
        onSynthesisComplete: async (audio, sampleRate) => {
          setVoiceState('speaking');
          const player = new AudioPlayback({ sampleRate });
          await player.play(audio, sampleRate);
          player.dispose();
        },
        onStateChange: (s) => {
          if (s === 'processingSTT') setVoiceState('processing');
          if (s === 'generatingResponse') setVoiceState('processing');
          if (s === 'playingTTS') setVoiceState('speaking');
        },
      });
      if (result) { setTranscript(result.transcription); setResponse(result.response); }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setVoiceState('idle');
    setAudioLevel(0);
  }, []);

  const startListening = useCallback(async () => {
    setTranscript('');
    setResponse('');
    setError(null);
    const anyMissing = !ModelManager.getLoadedModel(ModelCategory.Audio)
      || !ModelManager.getLoadedModel(ModelCategory.SpeechRecognition)
      || !ModelManager.getLoadedModel(ModelCategory.Language)
      || !ModelManager.getLoadedModel(ModelCategory.SpeechSynthesis);
    if (anyMissing) {
      const ok = await ensureModels();
      if (!ok) return;
    }
    setVoiceState('listening');
    const mic = new AudioCapture({ sampleRate: 16000 });
    micRef.current = mic;
    if (!pipelineRef.current) pipelineRef.current = new VoicePipeline();
    VAD.reset();
    vadUnsub.current = VAD.onSpeechActivity((activity) => {
      if (activity === SpeechActivity.Ended) {
        const segment = VAD.popSpeechSegment();
        if (segment && segment.samples.length > 1600) processSpeech(segment.samples);
      }
    });
    await mic.start(
      (chunk) => { VAD.processSamples(chunk); },
      (level) => { setAudioLevel(level); },
    );
  }, [ensureModels, processSpeech]);

  const stopListening = useCallback(() => {
    micRef.current?.stop();
    vadUnsub.current?.();
    setVoiceState('idle');
    setAudioLevel(0);
  }, []);

  const pendingLoaders = [
    { label: 'VAD', loader: vadLoader },
    { label: 'STT', loader: sttLoader },
    { label: 'LLM', loader: llmLoader },
    { label: 'TTS', loader: ttsLoader },
  ].filter((l) => l.loader.state !== 'ready');

  const cfg = STATE_CONFIG[voiceState];
  const orbScale = voiceState === 'listening' ? 1 + audioLevel * 0.3 : 1;

  return (
    <div className="tab-panel voice-panel">
      {pendingLoaders.length > 0 && voiceState === 'idle' && (
        <ModelBanner
          state={pendingLoaders[0].loader.state}
          progress={pendingLoaders[0].loader.progress}
          error={pendingLoaders[0].loader.error}
          onLoad={ensureModels}
          label={`Voice (${pendingLoaders.map((l) => l.label).join(', ')})`}
        />
      )}

      {error && (
        <div style={{
          margin: '12px 16px 0',
          padding: '10px 14px',
          background: 'var(--red-dim)',
          border: '1px solid rgba(239,68,68,0.2)',
          borderRadius: 'var(--radius-md)',
          fontSize: '12px',
          color: 'var(--red-text)',
        }}>
          {error}
        </div>
      )}

      <div className="voice-center">
        {/* Orb */}
        <div
          className="voice-orb"
          data-state={voiceState}
          style={{ '--level': audioLevel } as React.CSSProperties}
          onClick={voiceState === 'idle' ? startListening : voiceState === 'listening' ? stopListening : undefined}
        >
          <div
            className="voice-orb-inner"
            style={{ transform: `scale(${orbScale})` }}
          />
          <div className="voice-orb-icon">{cfg.icon}</div>
        </div>

        <p className="voice-status" style={{ color: cfg.color }}>{cfg.label}</p>

        {/* Model status pills */}
        <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            { label: 'VAD', loader: vadLoader },
            { label: 'STT', loader: sttLoader },
            { label: 'LLM', loader: llmLoader },
            { label: 'TTS', loader: ttsLoader },
          ].map(({ label, loader }) => (
            <span
              key={label}
              style={{
                fontSize: '10px',
                fontFamily: 'var(--font-mono)',
                fontWeight: '600',
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                background: loader.state === 'ready' ? 'var(--green-dim)' : 'var(--bg-2)',
                color: loader.state === 'ready' ? 'var(--green-text)' : 'var(--text-3)',
                border: `1px solid ${loader.state === 'ready' ? 'rgba(34,197,94,0.2)' : 'var(--border)'}`,
                transition: 'all 300ms ease',
              }}
            >
              {label} {loader.state === 'ready' ? '✓' : loader.state === 'loading' ? '…' : '○'}
            </span>
          ))}
        </div>

        {(voiceState === 'idle' || voiceState === 'loading-models') && (
          <button
            className="btn btn-primary btn-lg"
            onClick={startListening}
            disabled={voiceState === 'loading-models'}
          >
            {voiceState === 'loading-models' ? 'Loading...' : '🎙️ Start Listening'}
          </button>
        )}
        {voiceState === 'listening' && (
          <button className="btn btn-lg" onClick={stopListening}>
            ⏹ Stop
          </button>
        )}
      </div>

      {transcript && (
        <div className="voice-transcript">
          <h4>You said</h4>
          <p>{transcript}</p>
        </div>
      )}

      {response && (
        <div className="voice-response">
          <h4>AI response</h4>
          <p>{response}</p>
        </div>
      )}
    </div>
  );
}
