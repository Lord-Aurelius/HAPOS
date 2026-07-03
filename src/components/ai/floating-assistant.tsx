'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export function FloatingAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen]);

  const sendMessage = useCallback(async () => {
    const msg = input.trim();
    if (!msg || loading) return;
    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    try {
      const res = await fetch('/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'AI request failed');
        setMessages((prev) => prev.slice(0, -1));
        return;
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: data.content || 'No response generated.' }]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 56,
          height: 56,
          borderRadius: 28,
          background: 'var(--accent, #0f6f9d)',
          color: '#fff',
          border: 'none',
          cursor: 'pointer',
          fontSize: 24,
          zIndex: 999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-label="Open AI assistant"
      >
        AI
      </button>

      {isOpen ? (
        <div
          style={{
            position: 'fixed',
            bottom: 88,
            right: 24,
            width: 380,
            maxWidth: 'calc(100vw - 48px)',
            height: 500,
            maxHeight: 'calc(100vh - 120px)',
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            zIndex: 999,
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface, #f8f9fa)' }}>
            <strong>AEGIS</strong>
            <button type="button" onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 4 }} aria-label="Close assistant">✕</button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.length === 0 ? (
              <p className="muted" style={{ textAlign: 'center', padding: 24, fontSize: '0.8rem' }}>
                Ask about revenue, expenses, customers, services, or forecasts.
              </p>
            ) : (
              messages.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  background: m.role === 'user' ? 'rgba(15, 111, 157, 0.12)' : 'rgba(46, 160, 67, 0.08)',
                  borderRadius: 8,
                  padding: '8px 12px',
                  maxWidth: '85%',
                  whiteSpace: 'pre-wrap',
                  fontSize: '0.8rem',
                  lineHeight: 1.5,
                }}>
                  {m.content}
                </div>
              ))
            )}
            {loading ? <div style={{ alignSelf: 'flex-start', padding: '8px 12px', fontSize: '0.8rem' }}>Thinking...</div> : null}
            <div ref={bottomRef} />
          </div>

          {error ? (
            <div style={{ padding: '4px 12px', fontSize: '0.75rem', color: 'var(--danger)' }}>{error}</div>
          ) : null}

          <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>
            <input
              style={{ flex: 1, fontSize: '0.8rem' }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Ask AEGIS..."
              disabled={loading}
            />
            <button className="button" onClick={sendMessage} disabled={loading || !input.trim()} style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
              Send
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
