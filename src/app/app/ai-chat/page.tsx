'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type Message = {
  role: 'user' | 'assistant';
  content: string;
};

export default function AiChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      <section className="hero">
        <p className="hero-kicker">AI assistant</p>
        <h1 className="hero-title">Ask AEGIS about your business.</h1>
        <p className="hero-subtitle">
          Ask questions about revenue, expenses, customers, services, forecasts, risks, and opportunities.
          The AI uses your actual business data &mdash; never fabricated.
        </p>
      </section>

      {error ? (
        <div className="panel">
          <p className="pill" style={{ background: 'rgba(160, 60, 46, 0.12)', color: 'var(--danger)' }}>
            {error}
          </p>
        </div>
      ) : null}

      <section className="panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 400 }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.length === 0 ? (
            <p className="muted" style={{ textAlign: 'center', padding: 32 }}>
              Ask a question like &quot;How much revenue did we make this month?&quot; or &quot;What are our biggest risks?&quot;
            </p>
          ) : (
            messages.map((m, i) => (
              <div key={i} style={{
                alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                background: m.role === 'user' ? 'rgba(15, 111, 157, 0.12)' : 'rgba(46, 160, 67, 0.08)',
                borderRadius: 8,
                padding: '12px 16px',
                maxWidth: '80%',
                whiteSpace: 'pre-wrap',
                fontSize: '0.875rem',
                lineHeight: 1.6,
              }}>
                {m.content}
              </div>
            ))
          )}
          {loading ? (
            <div style={{
              alignSelf: 'flex-start',
              background: 'rgba(46, 160, 67, 0.08)',
              borderRadius: 8,
              padding: '12px 16px',
              fontSize: '0.875rem',
            }}>
              Thinking...
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 8 }}>
          <input
            style={{ flex: 1 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Ask about your business..."
            disabled={loading}
          />
          <button className="button" onClick={sendMessage} disabled={loading || !input.trim()}>
            Send
          </button>
        </div>
      </section>
    </>
  );
}
