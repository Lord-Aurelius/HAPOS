'use client';

import { useCallback, useEffect, useState } from 'react';

type AiDashboardData = {
  status: string;
  content?: string;
  error?: string;
};

type AiHealthData = {
  status: string;
  ai: { enabled: boolean; provider: string; providerStatus: string };
  tools: { registered: number; total: number; missing: string[] } | null;
};

type CardProps = {
  title: string;
  loading: boolean;
  content: string | null;
  error: string | null;
};

function Card({ title, loading, content, error }: CardProps) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h3>{title}</h3>
      </div>
      {loading ? (
        <p className="muted">Loading...</p>
      ) : error ? (
        <p className="muted" style={{ color: 'var(--danger)' }}>{error}</p>
      ) : content ? (
        <div className="ai-response" style={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', lineHeight: 1.6 }}>
          {content}
        </div>
      ) : (
        <p className="muted">No data available yet.</p>
      )}
    </div>
  );
}

export default function AiDashboardPage() {
  const [health, setHealth] = useState<AiHealthData | null>(null);
  const [insights, setInsights] = useState<AiDashboardData | null>(null);
  const [risks, setRisks] = useState<AiDashboardData | null>(null);
  const [opportunities, setOpportunities] = useState<AiDashboardData | null>(null);
  const [forecast, setForecast] = useState<AiDashboardData | null>(null);
  const [loading, setLoading] = useState({ health: true, insights: true, risks: true, opportunities: true, forecast: true });

  const fetchData = useCallback(async () => {
    try {
      const healthRes = await fetch('/api/v1/ai/health');
      const healthData = await healthRes.json();
      setHealth(healthData);
      setLoading((prev) => ({ ...prev, health: false }));
    } catch { setLoading((prev) => ({ ...prev, health: false })); }

    try {
      const insightsRes = await fetch('/api/v1/ai/insights', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: 'this_month' }) });
      const insightsData = await insightsRes.json();
      setInsights(insightsData);
      setLoading((prev) => ({ ...prev, insights: false }));
    } catch { setLoading((prev) => ({ ...prev, insights: false })); }

    try {
      const risksRes = await fetch('/api/v1/ai/risks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: 'this_month' }) });
      const risksData = await risksRes.json();
      setRisks(risksData);
      setLoading((prev) => ({ ...prev, risks: false }));
    } catch { setLoading((prev) => ({ ...prev, risks: false })); }

    try {
      const oppsRes = await fetch('/api/v1/ai/opportunities', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: 'this_month' }) });
      const oppsData = await oppsRes.json();
      setOpportunities(oppsData);
      setLoading((prev) => ({ ...prev, opportunities: false }));
    } catch { setLoading((prev) => ({ ...prev, opportunities: false })); }

    try {
      const forecastRes = await fetch('/api/v1/ai/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: 'next_month' }) });
      const forecastData = await forecastRes.json();
      setForecast(forecastData);
      setLoading((prev) => ({ ...prev, forecast: false }));
    } catch { setLoading((prev) => ({ ...prev, forecast: false })); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">AI dashboard</p>
        <h1 className="hero-title">Business intelligence dashboard.</h1>
        <p className="hero-subtitle">
          AI-powered analysis of your business performance. All data is from your actual business records &mdash; never fabricated.
        </p>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <h2>AI status</h2>
          </div>
          {loading.health ? (
            <p className="muted">Loading...</p>
          ) : health ? (
            <div className="field-grid">
              <div className="field">
                <label>Status</label>
                <span className={`pill`} style={{
                  background: health.status === 'ok' ? 'rgba(46, 160, 67, 0.12)' : 'rgba(160, 60, 46, 0.12)',
                  color: health.status === 'ok' ? 'var(--success)' : 'var(--danger)',
                }}>
                  {health.status === 'ok' ? 'Connected' : health.status === 'disabled' ? 'Disabled' : 'Error'}
                </span>
              </div>
              <div className="field">
                <label>Provider</label>
                <p className="muted" style={{ marginTop: 4 }}>{health.ai.provider}</p>
              </div>
              <div className="field">
                <label>Tools</label>
                <p className="muted" style={{ marginTop: 4 }}>
                  {health.tools ? `${health.tools.registered}/${health.tools.total} registered` : 'N/A'}
                </p>
              </div>
            </div>
          ) : (
            <p className="muted">Could not reach AI service.</p>
          )}
        </div>

        <Card title="Revenue insights" loading={loading.insights} content={insights?.content ?? null} error={insights?.error ?? null} />
        <Card title="Forecast" loading={loading.forecast} content={forecast?.content ?? null} error={forecast?.error ?? null} />
        <Card title="Risk detection" loading={loading.risks} content={risks?.content ?? null} error={risks?.error ?? null} />
        <Card title="Growth opportunities" loading={loading.opportunities} content={opportunities?.content ?? null} error={opportunities?.error ?? null} />
      </section>
    </>
  );
}
