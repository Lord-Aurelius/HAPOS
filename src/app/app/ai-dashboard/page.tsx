'use client';

import { useCallback, useEffect, useState } from 'react';
import { TrendingUp, DollarSign, CreditCard, Users, Activity, AlertTriangle, Lightbulb, BarChart3, Building2 } from 'lucide-react';

type DashboardData = {
  status: string; period: string; generatedAt: string;
  revenue: any; expenses: any; profitability: any; customers: any;
  healthScore: any; risks: any; opportunities: any; forecast: any; branches: any;
};

function formatCurrency(v: number | string | undefined | null): string {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '0'));
  return isNaN(n) ? 'KES 0' : `KES ${n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function safeNum(v: any): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

type MetricCardProps = { title: string; value: string; subtitle?: string; loading: boolean; icon: React.ReactNode; trend?: 'up' | 'down' | 'flat' };

function MetricCard({ title, value, subtitle, loading, icon, trend }: MetricCardProps) {
  return (
    <div className="snapshot-card">
      <div className="snapshot-card-header">
        <span className="snapshot-card-label">{title}</span>
        <span className="snapshot-card-icon">{icon}</span>
      </div>
      {loading ? <p className="muted" style={{ fontSize: '0.8rem' }}>Loading...</p> : (
        <>
          <div className="snapshot-card-value">{value}</div>
          {subtitle && <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: 2 }}>{subtitle}</div>}
          {trend && (
            <div className="snapshot-card-trend" style={{ color: trend === 'up' ? 'var(--success)' : trend === 'down' ? 'var(--danger)' : 'var(--muted)' }}>
              {trend === 'up' ? '▲' : trend === 'down' ? '▼' : '◆'} {trend}
            </div>
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
      <div className="hero" style={{ padding: 'var(--space-4) var(--space-5)' }}>
        <p className="hero-kicker"><BarChart3 size={12} />AI dashboard</p>
        <h1 className="hero-title">Business intelligence</h1>
        <p className="hero-subtitle">Real data from your business records &mdash; never fabricated.</p>
      </div>

      {error && <div className="panel" style={{ borderLeft: '3px solid var(--danger)' }}><p style={{ color: 'var(--danger)', fontSize: '0.85rem', margin: 0 }}>{error}</p></div>}

      <div className="snapshot-grid">
        <MetricCard title="Revenue" value={formatCurrency(rev?.total)} subtitle={rev?.period || 'this month'} loading={loading} icon={<DollarSign />} trend={prof?.netProfit > 0 ? 'up' : 'down'} />
        <MetricCard title="Expenses" value={formatCurrency(exp?.total)} subtitle={`${exp?.count || 0} transactions`} loading={loading} icon={<CreditCard />} />
        <MetricCard title="Net Profit" value={formatCurrency(prof?.netProfit)} subtitle={`Margin: ${safeNum(prof?.netProfit) > 0 ? (safeNum(prof.netProfit) * 100).toFixed(1) : '0'}%`} loading={loading} icon={<TrendingUp />} trend={safeNum(prof?.netProfit) > 0 ? 'up' : 'down'} />
        <MetricCard title="Customers" value={String(cust?.totalCustomers || 0)} subtitle={`${cust?.activeCustomers || 0} active`} loading={loading} icon={<Users />} />
        <MetricCard title="Avg Ticket" value={formatCurrency(rev?.averageTicket)} loading={loading} icon={<Activity />} />
        <MetricCard title="Health Score" value={data?.healthScore?.score !== undefined ? `${health.score}/100` : 'N/A'} subtitle={health?.rating || ''} loading={loading} icon={<Activity />} trend={safeNum(health?.score) >= 50 ? 'up' : 'down'} />
      </div>

      <div className="grid-two">
        <div className="panel">
          <div className="panel-header"><h3>Revenue breakdown</h3></div>
          {loading ? <p className="muted">Loading...</p> : rev ? (
            <div className="field-grid">
              <div className="list-row"><span style={{ fontSize: '0.8rem' }}>Total</span><strong>{formatCurrency(rev.total)}</strong></div>
              <div className="list-row"><span style={{ fontSize: '0.8rem' }}>Transactions</span><strong>{rev.transactionCount || 0}</strong></div>
              <div className="list-row"><span style={{ fontSize: '0.8rem' }}>Avg per ticket</span><strong>{formatCurrency(rev.averageTicket)}</strong></div>
            </div>
          ) : <p className="muted" style={{ fontSize: '0.8rem' }}>No data</p>}
        </div>

        <div className="panel">
          <div className="panel-header"><h3>Expenses by category</h3></div>
          {loading ? <p className="muted">Loading...</p> : exp?.byCategory?.length > 0 ? (
            <table className="table">
              <thead><tr><th>Category</th><th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'right' }}>Count</th></tr></thead>
              <tbody>
                {exp.byCategory.slice(0, 8).map((c: any, i: number) => (
                  <tr key={i}><td>{c.category || 'Uncategorised'}</td><td style={{ textAlign: 'right' }}>{formatCurrency(c.total)}</td><td style={{ textAlign: 'right' }}>{c.count}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted" style={{ fontSize: '0.8rem' }}>No expense categories found.</p>}
        </div>

        <div className="panel">
          <div className="panel-header"><h3><AlertTriangle size={14} style={{ marginRight: 6, display: 'inline' }} />Risk detection</h3></div>
          {loading ? <p className="muted">Loading...</p> : Array.isArray(risks) && risks.length > 0 ? (
            <div className="stack">
              {risks.map((r: RiskItem, i: number) => (
                <div key={i} style={{ padding: 'var(--space-2)', borderRadius: 'var(--radius)', background: r.severity === 'critical' ? 'var(--danger-soft)' : 'var(--warning-soft)', borderLeft: '3px solid ' + (r.severity === 'critical' ? 'var(--danger)' : 'var(--warning)') }}>
                  <p style={{ fontSize: '0.8rem', margin: 0 }}><strong>{r.type}:</strong> {r.message}</p>
                  {r.action && <p style={{ fontSize: '0.72rem', margin: 'var(--space-1) 0 0', color: 'var(--muted)' }}>→ {r.action}</p>}
                </div>
              ))}
            </div>
          ) : <p className="muted" style={{ fontSize: '0.8rem' }}>No risks detected.</p>}
        </div>

        <div className="panel">
          <div className="panel-header"><h3><Lightbulb size={14} style={{ marginRight: 6, display: 'inline' }} />Growth opportunities</h3></div>
          {loading ? <p className="muted">Loading...</p> : Array.isArray(opps) && opps.length > 0 ? (
            <div className="stack">
              {opps.map((o: OppItem, i: number) => (
                <div key={i} style={{ padding: 'var(--space-2)', borderRadius: 'var(--radius)', background: 'var(--success-soft)', borderLeft: '3px solid var(--success)' }}>
                  <p style={{ fontSize: '0.8rem', margin: 0 }}><strong>{o.type}:</strong> {o.message}</p>
                  {o.action && <p style={{ fontSize: '0.72rem', margin: 'var(--space-1) 0 0', color: 'var(--muted)' }}>→ {o.action}</p>}
                </div>
              ))}
            </div>
          ) : <p className="muted" style={{ fontSize: '0.8rem' }}>No opportunities identified.</p>}
        </div>

        <div className="panel">
          <div className="panel-header"><h3>Forecast</h3></div>
          {loading ? <p className="muted">Loading...</p> : fc?.projectedRevenue ? (
            <div className="field-grid">
              <div className="list-row"><span style={{ fontSize: '0.8rem' }}>Projected revenue</span><strong>{formatCurrency(fc.projectedRevenue)}</strong></div>
              <div className="list-row"><span style={{ fontSize: '0.8rem' }}>Confidence</span><strong>{fc.confidence || 'N/A'}</strong></div>
              <div className="list-row"><span style={{ fontSize: '0.8rem' }}>Data points</span><strong>{fc.dataPoints || 0} days</strong></div>
              <div className="list-row"><span style={{ fontSize: '0.8rem' }}>Trend factor</span><strong>{fc.trendFactor || 1}x</strong></div>
            </div>
          ) : fc?.message ? <p className="muted" style={{ fontSize: '0.8rem' }}>{fc.message}</p> : <p className="muted" style={{ fontSize: '0.8rem' }}>Insufficient data.</p>}
        </div>

        <div className="panel">
          <div className="panel-header"><h3><Building2 size={14} style={{ marginRight: 6, display: 'inline' }} />Branch performance</h3></div>
          {loading ? <p className="muted">Loading...</p> : branches.length > 0 ? (
            <table className="table">
              <thead><tr><th>Branch</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Expenses</th><th style={{ textAlign: 'right' }}>Profit</th></tr></thead>
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
          ) : <p className="muted" style={{ fontSize: '0.8rem' }}>No branch data available.</p>}
        </div>
      </div>
    </>
  );
}
