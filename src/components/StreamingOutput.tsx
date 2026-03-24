import { useEffect, useRef, useState, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface StreamingOutputProps {
  content: string;
  isStreaming: boolean;
  className?: string;
}

// Heavy markdown render — memoized so it only re-renders when content actually changes
const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        code({ node, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          const language = match ? match[1] : '';
          const inline = props.inline;
          return !inline && language ? (
            <SyntaxHighlighter
              style={oneLight as any}
              language={language}
              PreTag="div"
              customStyle={{
                margin: '12px 0',
                borderRadius: '8px',
                fontSize: '13px',
                padding: '14px 16px',
                background: '#f8fafc',
                border: '1px solid rgba(15,23,42,0.08)',
              }}
            >
              {String(children).replace(/\n$/, '')}
            </SyntaxHighlighter>
          ) : (
            <code className={className} {...props}>{children}</code>
          );
        },
        h1: ({ children }: any) => <h1 className="markdown-h1">{children}</h1>,
        h2: ({ children }: any) => <h2 className="markdown-h2">{children}</h2>,
        h3: ({ children }: any) => <h3 className="markdown-h3">{children}</h3>,
        p:  ({ children }: any) => <p  className="markdown-p">{children}</p>,
        ul: ({ children }: any) => <ul className="markdown-ul">{children}</ul>,
        ol: ({ children }: any) => <ol className="markdown-ol">{children}</ol>,
        li: ({ children }: any) => <li className="markdown-li">{children}</li>,
        blockquote: ({ children }: any) => <blockquote className="markdown-blockquote">{children}</blockquote>,
        a: ({ href, children }: any) => (
          <a href={href} className="markdown-link" target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

export function StreamingOutput({ content, isStreaming, className = '' }: StreamingOutputProps) {
  const endRef = useRef<HTMLDivElement>(null);
  // Throttled snapshot shown during streaming — updates at most once per second
  // so the heavy markdown tree doesn't re-render on every token.
  const [renderSnapshot, setRenderSnapshot] = useState(content);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When streaming ends, immediately sync the final content
  useEffect(() => {
    if (!isStreaming) {
      if (throttleRef.current) clearTimeout(throttleRef.current);
      setRenderSnapshot(content);
    }
  }, [isStreaming, content]);

  // While streaming: throttle markdown re-renders to once per second
  useEffect(() => {
    if (!isStreaming) return;
    if (throttleRef.current) return; // already scheduled
    throttleRef.current = setTimeout(() => {
      setRenderSnapshot(content);
      throttleRef.current = null;
    }, 1000);
  }, [content, isStreaming]);

  // Auto-scroll on new content
  useEffect(() => {
    if (isStreaming) {
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [renderSnapshot, isStreaming]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (throttleRef.current) clearTimeout(throttleRef.current);
  }, []);

  return (
    <div className={`streaming-output-wrap ${className}`}>
      {/* During streaming: plain pre-wrap text — zero markdown overhead per token */}
      {isStreaming ? (
        <pre className="streaming-content">{content}<span className="streaming-cursor" /></pre>
      ) : (
        <MarkdownRenderer content={renderSnapshot} />
      )}
      <div ref={endRef} />
    </div>
  );
}
