'use client';

import { useCallback, useEffect, useState } from 'react';

type DashboardData = {
  status: string;
  period: string;
  revenue: any;
  expenses: any;
  profitability: any;
  customers: any;
  healthScore: any;
  risks: any;
  opportunities: any;
  forecast: any;
  branches: any;
  generatedAt: string;
};

function formatCurrency(v: number | string | undefined | null): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
  return isNaN(n) ? 'KES 0' : `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safeNum(v: any): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

type MetricCardProps = {
  title: string;
  value: string;
  subtitle?: string;
  loading: boolean;
  trend?: 'up' | 'down' | 'flat';
};

function MetricCard({ title, value, subtitle, loading, trend }: MetricCardProps) {
  return (
    <div className="panel" style={{ textAlign: 'center' }}>
      <div className="panel-header" style={{ justifyContent: 'center' }}><h3>{title}</h3></div>
      {loading ? <p className="muted">Loading...</p> : (
        <>
          <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: '8px 0' }}>{value}</p>
          {subtitle && <p className="muted" style={{ fontSize: '0.8rem' }}>{subtitle}</p>}
          {trend && (
            <span style={{ fontSize: '0.8rem', color: trend === 'up' ? 'var(--success)' : trend === 'down' ? 'var(--danger)' : 'var(--muted)' }}>
              {trend === 'up' ? '▲' : trend === 'down' ? '▼' : '◆'} {trend}
            </span>
          )}
        </>
      )}
    </div>
  );
}

type RiskItem = { type: string; severity: string; message: string; action?: string };
type OppItem = { type: string; severity: string; message: string; action?: string };

export default function AiDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/ai/dashboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ period: 'this_month' }) });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Failed'); setLoading(false); return; }
      setData(json);
      setError(null);
    } catch (e: any) { setError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const rev = data?.revenue;
  const exp = data?.expenses;
  const prof = data?.profitability;
  const cust = data?.customers;
  const health = data?.healthScore;
  const risks = data?.risks?.risks || data?.risks || [];
  const opps = data?.opportunities?.opportunities || data?.opportunities || [];
  const fc = data?.forecast;
  const branches = data?.branches?.branches || [];

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">AI dashboard</p>
        <h1 className="hero-title">Business intelligence dashboard.</h1>
        <p className="hero-subtitle">
          Real data from your business records &mdash; never fabricated. All figures are based on actual HAPOS transactions.
        </p>
      </section>

      {error && <div className="panel" style={{ borderLeft: '4px solid var(--danger)', marginBottom: 16 }}><p style={{ color: 'var(--danger)' }}>{error}</p></div>}

      {/* KPI Row */}
      <section className="grid-three" style={{ marginBottom: 24 }}>
        <MetricCard title="Revenue" value={formatCurrency(rev?.total)} subtitle={rev?.period || 'this month'} loading={loading} trend={prof?.netProfit > 0 ? 'up' : 'down'} />
        <MetricCard title="Expenses" value={formatCurrency(exp?.total)} subtitle={`${exp?.count || 0} transactions`} loading={loading} />
        <MetricCard title="Net Profit" value={formatCurrency(prof?.netProfit)} subtitle={`Margin: ${safeNum(prof?.netMargin) > 0 ? (safeNum(prof.netMargin) * 100).toFixed(1) : '0'}%`} loading={loading} trend={safeNum(prof?.netProfit) > 0 ? 'up' : 'down'} />
        <MetricCard title="Customers" value={String(cust?.totalCustomers || 0)} subtitle={`${cust?.activeCustomers || 0} active`} loading={loading} />
        <MetricCard title="Avg Ticket" value={formatCurrency(rev?.averageTicket)} loading={loading} />
        <MetricCard title="Health Score" value={data?.healthScore?.score !== undefined ? `${health.score}/100` : 'N/A'} subtitle={health?.rating || ''} loading={loading} trend={safeNum(health?.score) >= 50 ? 'up' : 'down'} />
      </section>

      {/* Two-column layout */}
      <section className="grid-two">
        {/* Revenue Detail */}
        <div className="panel">
          <div className="panel-header"><h3>Revenue breakdown</h3></div>
          {loading ? <p className="muted">Loading...</p> : rev ? (
            <div className="field-grid">
              <div className="field"><label>Total</label><p>{formatCurrency(rev.total)}</p></div>
              <div className="field"><label>Transactions</label><p>{rev.transactionCount || 0}</p></div>
              <div className="field"><label>Avg per ticket</label><p>{formatCurrency(rev.averageTicket)}</p></div>
            </div>
          ) : <p className="muted">No data</p>}
        </div>

        {/* Expense Detail */}
        <div className="panel">
          <div className="panel-header"><h3>Expenses by category</h3></div>
          {loading ? <p className="muted">Loading...</p> : exp?.byCategory?.length > 0 ? (
            <table style={{ width: '100%', fontSize: '0.85rem' }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Category</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Count</th></tr></thead>
              <tbody>
                {exp.byCategory.slice(0, 8).map((c: any, i: number) => (
                  <tr key={i}><td>{c.category || 'Uncategorised'}</td><td style={{ textAlign: 'right' }}>{formatCurrency(c.total)}</td><td style={{ textAlign: 'right' }}>{c.count}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No expense categories found.</p>}
        </div>

        {/* Risk Detection */}
        <div className="panel">
          <div className="panel-header"><h3>Risk detection</h3></div>
          {loading ? <p className="muted">Loading...</p> : Array.isArray(risks) && risks.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {risks.map((r: RiskItem, i: number) => (
                <div key={i} style={{ padding: 8, borderRadius: 6, background: r.severity === 'critical' ? 'rgba(160,60,46,0.08)' : 'rgba(255,183,77,0.1)', borderLeft: `3px solid ${r.severity === 'critical' ? 'var(--danger)' : 'var(--warning)'}` }}>
                  <p style={{ fontSize: '0.85rem', margin: 0 }}><strong>{r.type}:</strong> {r.message}</p>
                  {r.action && <p style={{ fontSize: '0.75rem', margin: '4px 0 0', color: 'var(--muted)' }}>→ {r.action}</p>}
                </div>
              ))}
            </div>
          ) : <p className="muted">No risks detected.</p>}
        </div>

        {/* Opportunities */}
        <div className="panel">
          <div className="panel-header"><h3>Growth opportunities</h3></div>
          {loading ? <p className="muted">Loading...</p> : Array.isArray(opps) && opps.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {opps.map((o: OppItem, i: number) => (
                <div key={i} style={{ padding: 8, borderRadius: 6, background: 'rgba(46,160,67,0.06)', borderLeft: '3px solid var(--success)' }}>
                  <p style={{ fontSize: '0.85rem', margin: 0 }}><strong>{o.type}:</strong> {o.message}</p>
                  {o.action && <p style={{ fontSize: '0.75rem', margin: '4px 0 0', color: 'var(--muted)' }}>→ {o.action}</p>}
                </div>
              ))}
            </div>
          ) : <p className="muted">No opportunities identified.</p>}
        </div>

        {/* Forecast */}
        <div className="panel">
          <div className="panel-header"><h3>Forecast (next month)</h3></div>
          {loading ? <p className="muted">Loading...</p> : fc?.projectedRevenue ? (
            <div className="field-grid">
              <div className="field"><label>Projected revenue</label><p>{formatCurrency(fc.projectedRevenue)}</p></div>
              <div className="field"><label>Confidence</label><p>{fc.confidence || 'N/A'}</p></div>
              <div className="field"><label>Data points</label><p>{fc.dataPoints || 0} days</p></div>
              <div className="field"><label>Trend factor</label><p>{fc.trendFactor || 1}x</p></div>
            </div>
          ) : fc?.message ? <p className="muted">{fc.message}</p> : <p className="muted">Insufficient data.</p>}
        </div>

        {/* Branch Performance */}
        <div className="panel">
          <div className="panel-header"><h3>Branch performance</h3></div>
          {loading ? <p className="muted">Loading...</p> : branches.length > 0 ? (
            <table style={{ width: '100%', fontSize: '0.85rem' }}>
              <thead><tr><th style={{ textAlign: 'left' }}>Branch</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Expenses</th><th style={{ textAlign: 'right' }}>Profit</th></tr></thead>
              <tbody>
                {branches.map((b: any, i: number) => (
                  <tr key={i}>
                    <td>{b.branchName || 'Main'}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b.revenue)}</td>
                    <td style={{ textAlign: 'right' }}>{formatCurrency(b.expenses)}</td>
                    <td style={{ textAlign: 'right', color: safeNum(b.profit) >= 0 ? 'var(--success)' : 'var(--danger)' }}>{formatCurrency(b.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No branch data available.</p>}
        </div>
      </section>
    </>
  );
}
