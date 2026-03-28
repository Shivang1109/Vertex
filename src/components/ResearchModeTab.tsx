import { useState, useCallback, useRef, useEffect } from 'react';
import { ModelCategory } from '@runanywhere/web';
import { TextGeneration } from '@runanywhere/web-llamacpp';
import { useModelLoaderWithOverlay } from '../hooks/useModelLoaderWithOverlay';
import { ModelBanner } from './ModelBanner';
import { StreamingOutput } from './StreamingOutput';
import { ActionBar } from './ActionBar';
import * as pdfjsLib from 'pdfjs-dist';
import { saveDocument, getDocuments, deleteDocument, saveResearchHistory, type StoredDocument } from '../utils/storage';
import { usePrivacyMonitor } from '../context/PrivacyMonitorContext';
import { useModel } from '../context/ModelContext';
import { useKeyboardShortcuts } from '../context/KeyboardShortcutsContext';
import { ModelSwitcher } from './ModelSwitcher';

// Configure PDF.js worker - use local worker instead of CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

interface DocumentChunk {
  documentId: string;
  documentName: string; 
  chunkIndex: number;
  text: string;
}

// Semantic chunking: split on paragraph boundaries, ~800 chars per chunk
// (smaller than before to stay well within WASM context limits)
function chunkText(text: string, documentId: string, documentName: string, targetSize = 800, overlap = 80): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  const paragraphs = text.split(/\n{2,}/);
  let current = '';
  let chunkIndex = 0;

  const pushChunk = (t: string) => {
    const trimmed = t.trim();
    if (trimmed.length < 30) return;
    chunks.push({ documentId, documentName, chunkIndex: chunkIndex++, text: trimmed });
  };

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    if (current.length + trimmed.length <= targetSize) {
      current += (current ? '\n\n' : '') + trimmed;
    } else {
      if (current) pushChunk(current);
      const overlapText = current.slice(-overlap);
      current = overlapText + (overlapText ? '\n\n' : '') + trimmed;
    }
  }
  if (current) pushChunk(current);
  return chunks;
}

// Top-K chunk retrieval: score each chunk against the query using simple
// TF-style keyword overlap. Returns the top K chunks by relevance score.
// Falls back to first-K for non-QA actions where there's no query.
function selectTopKChunks(chunks: DocumentChunk[], query: string, k = 4): DocumentChunk[] {
  if (!query.trim()) return chunks.slice(0, k);

  // Tokenise query into lowercase words, strip stop words
  const STOP = new Set(['the','a','an','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should','may',
    'might','shall','can','need','dare','ought','used','to','of','in','for',
    'on','with','at','by','from','as','into','through','about','and','or','but',
    'if','then','that','this','these','those','it','its','i','you','he','she',
    'we','they','what','which','who','how','when','where','why']);

  const queryTokens = query.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));

  if (queryTokens.length === 0) return chunks.slice(0, k);

  // Score: count of query token occurrences in chunk (normalised by chunk length)
  const scored = chunks.map(chunk => {
    const lower = chunk.text.toLowerCase();
    let hits = 0;
    for (const token of queryTokens) {
      // Count occurrences
      let pos = 0;
      while ((pos = lower.indexOf(token, pos)) !== -1) { hits++; pos += token.length; }
    }
    // Normalise by word count so short chunks don't dominate
    const words = chunk.text.split(/\s+/).length;
    const score = hits / Math.sqrt(words);
    return { chunk, score };
  });

  // Sort descending, take top K, restore original order for coherence
  const topK = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .sort((a, b) => a.chunk.chunkIndex - b.chunk.chunkIndex);

  return topK.map(s => s.chunk);
}

type ResearchAction = 'qa' | 'outline' | 'citations';

interface ResearchResult {
  action: ResearchAction;
  output: string;
  tokensPerSec?: number;
  latencyMs?: number;
}

export function ResearchModeTab() {
  const loader = useModelLoaderWithOverlay(ModelCategory.Language);
  const [documents, setDocuments] = useState<StoredDocument[]>([]);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [processing, setProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [parsingFile, setParsingFile] = useState<string | null>(null); // PDF parse progress
  const [lastAction, setLastAction] = useState<ResearchAction | null>(null);
  const [truncated, setTruncated] = useState(false); // context window warning
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<(() => void) | null>(null);
  const { incrementTokens } = usePrivacyMonitor();
  const { setInferenceActive } = useModel();
  const { registerHandlers, modKey } = useKeyboardShortcuts();

  // Load documents from IndexedDB on mount
  useEffect(() => {
    getDocuments().then(setDocuments).catch(console.error);
  }, []);

  // Parse PDF client-side with per-page progress
  const parsePDF = useCallback(async (file: File): Promise<StoredDocument | null> => {
    try {
      setParsingFile(file.name);
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      let fullText = '';
      const metadata = await pdf.getMetadata().catch(() => ({ info: {} }));

      for (let i = 1; i <= pdf.numPages; i++) {
        setParsingFile(`${file.name} — page ${i}/${pdf.numPages}`);
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        fullText += pageText + '\n\n';
      }

      const info = metadata.info as any;
      const doc: StoredDocument = {
        id: `${file.name}-${Date.now()}`,
        name: file.name,
        text: fullText.trim(),
        timestamp: Date.now(),
        metadata: {
          title: info?.Title || file.name,
          author: info?.Author,
          subject: info?.Subject,
        },
      };

      await saveDocument(doc);
      return doc;
    } catch (err) {
      console.error('PDF parsing error:', err);
      alert(`Failed to parse ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      return null;
    } finally {
      setParsingFile(null);
    }
  }, []);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files) return;
    
    const pdfFiles = Array.from(files).filter(f => f.type === 'application/pdf');
    if (pdfFiles.length === 0) {
      alert('Please upload PDF files only');
      return;
    }

    for (const file of pdfFiles) {
      const doc = await parsePDF(file);
      if (doc) {
        setDocuments(prev => [...prev, doc]);
      }
    }
  }, [parsePDF]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const removeDocument = useCallback(async (id: string) => {
    await deleteDocument(id);
    setDocuments(prev => prev.filter(d => d.id !== id));
  }, []);

  const runResearchAction = useCallback(async (action: ResearchAction) => {
    if (documents.length === 0) {
      setResult({
        action,
        output: 'Please upload at least one PDF document first.',
      });
      return;
    }

    if (action === 'qa' && !query.trim()) {
      setResult({
        action,
        output: 'Please enter a question.',
      });
      return;
    }

    if (loader.state !== 'ready') {
      setResult({
        action,
        output: 'Please download and load the model first.',
      });
      return;
    }

    setProcessing(true);
    setInferenceActive(true);
    setResult(null);
    setLastAction(action);
    setTruncated(false);

    try {
      // Hard-slice the raw document text — don't rely on chunks fitting.
      // Take the first MAX_CHARS of each document's text directly.
      // This guarantees we always have content and never send an empty prompt.
      const is1B = localStorage.getItem('privateide_model') === 'lfm2-1.2b-tool-q4_k_m';
      const MAX_CHARS = is1B ? 1200 : 400;

      // For QA: score chunks and pick best one, then hard-slice it
      // For outline/citations: just take the start of the first document
      let contextText = '';
      if (action === 'qa' && query.trim()) {
        const allChunks: DocumentChunk[] = [];
        for (const doc of documents) {
          allChunks.push(...chunkText(doc.text, doc.id, doc.name));
        }
        const best = selectTopKChunks(allChunks, query, 1);
        const raw = best.length > 0 ? best[0].text : documents[0].text;
        contextText = raw.slice(0, MAX_CHARS);
      } else {
        contextText = documents[0].text.slice(0, MAX_CHARS);
      }

      // Always warn — we're always truncating large docs
      const totalChars = documents.reduce((s, d) => s + d.text.length, 0);
      if (totalChars > MAX_CHARS) setTruncated(true);

      // Safety: if we somehow still have no context, bail early
      if (!contextText.trim()) {
        setResult({ action, output: 'Could not extract text from the document. Try a different PDF.' });
        setProcessing(false);
        setInferenceActive(false);
        return;
      }

      const docLabel = documents[0].name;

      let prompt = '';

      if (action === 'qa') {
        prompt = `Document: ${docLabel}\n\n${contextText}\n\nQuestion: ${query}\nAnswer briefly:`;
      } else if (action === 'outline') {
        const topic = query || 'the topic in this document';
        prompt = `Document: ${docLabel}\n\n${contextText}\n\nWrite a thesis outline for: ${topic}\nOutline:`;
      } else if (action === 'citations') {
        const d = documents[0];
        prompt = `Format this as APA, MLA, and IEEE citations:\nTitle: ${d.metadata?.title || d.name}\nAuthor: ${d.metadata?.author || 'Unknown'}\n\nCitations:`;
      }

      const { stream, result: resultPromise, cancel } = await TextGeneration.generateStream(prompt, {
        maxTokens: 400,
        temperature: 0.4,
      });
      cancelRef.current = cancel;

      let accumulated = '';
      for await (const token of stream) {
        accumulated += token;
        incrementTokens(1); // Track tokens in privacy shield
        setResult({
          action,
          output: accumulated,
        });
      }

      const finalResult = await resultPromise;
      const finalOutput = finalResult.text || accumulated;
      
      setResult({
        action,
        output: finalOutput,
        tokensPerSec: finalResult.tokensPerSecond,
        latencyMs: finalResult.latencyMs,
      });

      // Save to history
      if (action === 'qa' && finalOutput && !finalOutput.startsWith('Error:')) {
        await saveResearchHistory(query, finalOutput);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setResult({
        action,
        output: `Error: ${msg}`,
      });
    } finally {
      cancelRef.current = null;
      setProcessing(false);
      setInferenceActive(false);
    }
  }, [documents, query, loader, incrementTokens, setInferenceActive]);

  const handleCancel = () => {
    cancelRef.current?.();
    setProcessing(false);
    setInferenceActive(false);
  };

  const handleExportResult = () => {
    if (!result) return;
    const actionLabel: Record<ResearchAction, string> = {
      qa: 'Q&A',
      outline: 'Thesis Outline',
      citations: 'Formatted Citations',
    };
    const docNames = documents.map(d => `- ${d.metadata?.title || d.name}`).join('\n');
    const md = [
      `# PrivateIDE Research — ${actionLabel[result.action]}`,
      `> Generated locally on-device. Zero bytes sent to cloud.`,
      ``,
      `## Documents`,
      docNames,
      ``,
      query ? `## Query\n${query}\n` : '',
      `## ${actionLabel[result.action]}`,
      result.output,
      ``,
      `---`,
      `*Generated by [PrivateIDE](https://github.com) — 100% on-device AI*`,
    ].join('\n');

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `research-${result.action}-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Register keyboard shortcut handlers
  useEffect(() => {
    registerHandlers({
      onOpenPdfPicker: () => fileInputRef.current?.click(),
      onSubmitQuestion: () => {
        if (query.trim() && !processing) {
          runResearchAction('qa');
        }
      },
      onGenerateOutline: () => runResearchAction('outline'),
      onFormatCitations: () => runResearchAction('citations'),
      onRetry: () => { if (lastAction) runResearchAction(lastAction); },
    });
  }, [registerHandlers, runResearchAction, query, processing, lastAction]);

  return (
    <div className="tab-panel research-mode-panel">
      <ModelBanner
        state={loader.state}
        progress={loader.progress}
        error={loader.error}
        onLoad={loader.ensure}
        label="Research LLM"
      />

      <div className="research-mode-layout">
        {/* Left Panel - Document Management */}
        <div className="research-mode-input">
          <div className="research-mode-input-inner">
            <h3>📚 Document Library</h3>
            <ModelSwitcher onModelChange={() => loader.ensure()} />

            <div
              className={`pdf-drop-zone ${isDragging ? 'dragging' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <p>📁 Drag & Drop PDFs Here</p>
              <p className="drop-zone-hint">or click to browse</p>
              <p className="drop-zone-privacy">🔒 Parsed 100% locally in browser</p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)}
            />

            {parsingFile && (
              <div className="pdf-parse-progress">
                <div className="shimmer-bar" />
                <span>📄 Parsing: {parsingFile}</span>
              </div>
            )}

            {/* Resend-style filter pill row */}
            <div className="doc-list-header">
              <span className="doc-list-count">
                {documents.length === 0 ? 'No documents' : `${documents.length} document${documents.length !== 1 ? 's' : ''}`}
              </span>
              {documents.length > 0 && (
                <span className="doc-list-size-pill">
                  {Math.round(documents.reduce((s, d) => s + d.text.length, 0) / 1000)}KB total
                </span>
              )}
            </div>

            <div className="document-list">
              {documents.length === 0 && (
                <p className="text-muted">No documents loaded yet</p>
              )}
              {documents.map(doc => (
                <div key={doc.id} className="document-card">
                  <div className="document-info">
                    <strong>{doc.name}</strong>
                    <span className="document-size">{Math.round(doc.text.length / 1000)}KB text</span>
                  </div>
                  <button
                    className="btn-destructive remove-btn"
                    onClick={() => removeDocument(doc.id)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="research-actions">
            <input
              type="text"
              placeholder="Ask a question about your documents..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="research-query-input"
              onKeyDown={(e) => e.key === 'Enter' && runResearchAction('qa')}
            />

            <button
              className="btn-primary"
              onClick={() => runResearchAction('qa')}
              disabled={processing || documents.length === 0}
            >
              💬 Ask Question <kbd>{modKey}↵</kbd>
            </button>

            <button
              className="btn"
              onClick={() => runResearchAction('outline')}
              disabled={processing || documents.length === 0}
            >
              📋 Generate Outline <kbd>{modKey}⇧O</kbd>
            </button>

            <button
              className="btn"
              onClick={() => runResearchAction('citations')}
              disabled={processing || documents.length === 0}
            >
              📖 Format Citations <kbd>{modKey}⇧C</kbd>
            </button>

            {processing && (
              <button className="btn" onClick={handleCancel}>
                ⏹ Stop
              </button>
            )}
          </div>
        </div>

        {/* Right Panel - Results */}
        <div className="research-mode-output">
          {!result && !processing && (
            <div className="empty-state">
              <h3>🔬 Private Research Assistant</h3>
              <p>Upload unpublished PDFs - thesis drafts, lab results, papers.</p>
              <p><strong>Nothing leaves your device.</strong></p>
              <ul className="feature-list">
                <li>💬 Ask questions across all documents</li>
                <li>📋 Generate thesis chapter outlines</li>
                <li>📖 Auto-format citations (APA/MLA/IEEE)</li>
              </ul>
            </div>
          )}

          {processing && !result && (
            <div className="research-skeleton-state">
              <div className="research-skeleton-header">
                <div className="research-skeleton-bar" style={{ width: '40%' }} />
                <div className="research-skeleton-bar" style={{ width: '20%' }} />
              </div>
              <div className="research-skeleton-bar" style={{ width: '95%' }} />
              <div className="research-skeleton-bar" style={{ width: '88%' }} />
              <div className="research-skeleton-bar" style={{ width: '92%' }} />
              <div className="research-skeleton-bar" style={{ width: '75%' }} />
              <div className="research-skeleton-bar" style={{ width: '83%', marginTop: 8 }} />
              <div className="research-skeleton-bar" style={{ width: '90%' }} />
              <div className="research-skeleton-bar" style={{ width: '60%' }} />
              <p className="research-skeleton-label">Analyzing documents locally…</p>
            </div>
          )}

          {result && (
            <div className="result-card">
              <div className="result-header">
                <h4>
                  {result.action === 'qa' && '💬 Answer'}
                  {result.action === 'outline' && '📋 Thesis Outline'}
                  {result.action === 'citations' && '📖 Formatted Citations'}
                </h4>
                <div className="result-header-actions">
                  {result.tokensPerSec && (
                    <span className="result-stats">
                      {result.tokensPerSec.toFixed(1)} tok/s · {result.latencyMs?.toFixed(0)}ms
                    </span>
                  )}
                  {!processing && lastAction && (
                    <button
                      className="btn btn-sm"
                      onClick={() => runResearchAction(lastAction)}
                      title="Run again"
                    >
                      🔄 Retry
                    </button>
                  )}
                  {!processing && result && (
                    <button
                      className="btn btn-sm"
                      onClick={handleExportResult}
                      title="Export as Markdown"
                    >
                      ⬇️ Export .md
                    </button>
                  )}
                </div>
              </div>

              {truncated && (
                <div className="truncation-warning">
                  ⚠️ Some document content was trimmed to fit the model's context window (~1000 tokens). Results may be incomplete for large documents.
                </div>
              )}
              
              <StreamingOutput 
                content={result.output}
                isStreaming={processing}
              />
              
              {!processing && (
                <ActionBar
                  content={result.output}
                  showInsert={false}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
