import { DollarSign, TrendingUp, Briefcase, CalendarDays, Users, CreditCard } from 'lucide-react';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { requireSession } from '@/server/auth/demo-session';
import { getDashboardSummary, getStaffMetrics } from '@/server/services/app-data';
import { BusinessSnapshot } from '@/components/layout/business-snapshot';
import { ExecutiveSummary } from '@/components/layout/executive-summary';

function formatDelta(value: number) {
  if (value === 0) {return formatCurrency(0);}
  return `${value > 0 ? '+' : '-'}${formatCurrency(Math.abs(value))}`;
}

function getDeltaClass(value: number) {
  if (value > 0) {return 'trend-positive';}
  if (value < 0) {return 'trend-negative';}
  return 'trend-neutral';
}

export default async function DashboardPage() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {return null;}

  const [summary, staffMetrics] = await Promise.all([
    getDashboardSummary(session),
    session.user.role === 'staff' ? getStaffMetrics(session.tenant.id, session.user.id) : Promise.resolve(null),
  ]);

  const revenueDelta = summary.monthRevenue - summary.previousMonthRevenue;
  const commissionDelta = summary.monthCommissionAccrued - summary.previousMonthCommissionAccrued;
  const isStaff = session.user.role === 'staff';

  const execLines: Array<{ icon: 'positive' | 'negative' | 'neutral'; text: string }> = [
    { icon: revenueDelta > 0 ? 'positive' : 'negative', text: `Revenue ${revenueDelta > 0 ? 'increased' : 'decreased'} ${formatCurrency(Math.abs(revenueDelta))} compared to last month.` },
    { icon: 'neutral', text: `${summary.highestEarner?.staffName || 'Staff'} generated the highest income this month.` },
    { icon: summary.monthlyTrend?.length > 0 ? 'positive' : 'neutral', text: 'Business operations remain active with consistent service volume.' },
  ];

  const snapshotItems = isStaff && staffMetrics ? [
    { icon: <DollarSign />, label: 'Today sales', value: formatCurrency(staffMetrics.todaySales) },
    { icon: <CalendarDays />, label: 'This month', value: formatCurrency(staffMetrics.monthSales) },
    { icon: <Briefcase />, label: 'Commission', value: formatCurrency(staffMetrics.monthCommission), trend: { value: commissionDelta, label: 'vs last month' } },
    { icon: <TrendingUp />, label: 'Lifetime income', value: formatCurrency(summary.lifetimeRevenue) },
  ] : [
    { icon: <DollarSign />, label: 'Today revenue', value: formatCurrency(summary.todayRevenue) },
    { icon: <CalendarDays />, label: 'This month', value: formatCurrency(summary.monthRevenue), trend: { value: revenueDelta, label: 'vs last month' } },
    { icon: <Briefcase />, label: 'Commission', value: formatCurrency(summary.monthCommissionAccrued), trend: { value: commissionDelta, label: 'vs last month' } },
    { icon: <CreditCard />, label: 'Net profit', value: formatCurrency(summary.monthNetProfit) },
    { icon: <TrendingUp />, label: 'Total income', value: formatCurrency(summary.lifetimeRevenue) },
    { icon: <Users />, label: 'Top earner', value: summary.highestEarner?.staffName ? `${summary.highestEarner.staffName} / ${formatCurrency(summary.highestEarner.totalRevenue)}` : 'N/A' },
  ];

  return (
    <>
      <div className="grid-12">
        <div className="col-span-9">
          <div className="hero" style={{ padding: 'var(--space-4) var(--space-5)' }}>
            <p className="hero-kicker">
              <TrendingUp size={12} />
              {isStaff ? 'Staff dashboard' : 'Shop dashboard'}
            </p>
            <h1 className="hero-title">{session.tenant.name}</h1>
          </div>
        </div>
        <div className="col-span-3">
          <div className="panel" style={{ height: '100%' }}>
            <div className="panel-header"><h3 style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Business info</h3></div>
            <div className="stack" style={{ gap: 'var(--space-1)' }}>
              <div className="list-row" style={{ padding: 'var(--space-1) 0' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>User</span>
                <span style={{ fontSize: '0.78rem' }}>{session.user.fullName}</span>
              </div>
              <div className="list-row" style={{ padding: 'var(--space-1) 0' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Role</span>
                <span style={{ fontSize: '0.78rem' }}>{session.user.role.replace('_', ' ')}</span>
              </div>
              <div className="list-row" style={{ padding: 'var(--space-1) 0' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Branch</span>
                <span style={{ fontSize: '0.78rem' }}>{session.tenant.slug}</span>
              </div>
              <div className="list-row" style={{ padding: 'var(--space-1) 0' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Status</span>
                <span className="pill" style={{ fontSize: '0.65rem' }}>{session.tenant.status || 'Active'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ExecutiveSummary
        lines={execLines}
        dateLabel={new Date().toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        recommendedAction={
          !isStaff && summary.highestEarner
            ? `Increase promotion of high-performing services from ${summary.highestEarner.staffName}.`
            : undefined
        }
      />

      <BusinessSnapshot items={snapshotItems} />

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Month comparison</h2>
              <p className="panel-copy">Current vs previous month.</p>
            </div>
          </div>

          <div className="comparison-grid">
            <article className="comparison-card">
              <span className="comparison-label">{summary.currentMonthLabel}</span>
              <strong className="comparison-value">{formatCurrency(summary.monthRevenue)}</strong>
              <span className="comparison-note">{formatCurrency(summary.monthCommissionAccrued)} commission</span>
            </article>
            <article className="comparison-card">
              <span className="comparison-label">{summary.previousMonthLabel}</span>
              <strong className="comparison-value">{formatCurrency(summary.previousMonthRevenue)}</strong>
              <span className="comparison-note">{formatCurrency(summary.previousMonthCommissionAccrued)} commission</span>
            </article>
          </div>

          <div className="stack" style={{ marginTop: 'var(--space-3)' }}>
            <div className="list-row">
              <div><strong>Revenue change</strong><div className="eyebrow">Current vs previous month</div></div>
              <strong className={getDeltaClass(revenueDelta)}>{formatDelta(revenueDelta)}</strong>
            </div>
            <div className="list-row">
              <div><strong>Commission change</strong><div className="eyebrow">Movement across two months</div></div>
              <strong className={getDeltaClass(commissionDelta)}>{formatDelta(commissionDelta)}</strong>
            </div>
            <div className="list-row">
              <div><strong>{isStaff ? 'Lifetime commission' : 'All-time commission'}</strong><div className="eyebrow">Running total from recorded services</div></div>
              <strong>{formatCurrency(summary.lifetimeCommission)}</strong>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{isStaff ? 'Your month' : 'Top earner insight'}</h2>
              <p className="panel-copy">{isStaff ? 'Your numbers, clients, and earnings.' : 'Who is leading the floor.'}</p>
            </div>
          </div>

          {isStaff && staffMetrics ? (
            <div className="stack">
              <div className="list-row">
                <div><strong>Clients this month</strong><div className="eyebrow">Unique customers handled</div></div>
                <strong>{staffMetrics.monthClients}</strong>
              </div>
              <div className="list-row">
                <div><strong>Clients today</strong><div className="eyebrow">Served in current shift</div></div>
                <strong>{staffMetrics.todayClients}</strong>
              </div>
              <div className="list-row">
                <div><strong>Month commission</strong><div className="eyebrow">Earned so far this month</div></div>
                <strong className="trend-positive">{formatCurrency(staffMetrics.monthCommission)}</strong>
              </div>
              <div className="list-row">
                <div><strong>Lifetime income</strong><div className="eyebrow">Total value of recorded services</div></div>
                <strong>{formatCurrency(summary.lifetimeRevenue)}</strong>
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="list-row">
                <div><strong>{summary.highestEarner?.staffName ?? 'No staff data yet'}</strong><div className="eyebrow">Top revenue contributor</div></div>
                <strong>{formatCurrency(summary.highestEarner?.totalRevenue ?? 0)}</strong>
              </div>
              <div className="list-row">
                <div><strong>Top earner commission</strong><div className="eyebrow">Attached commission</div></div>
                <strong>{formatCurrency(summary.highestEarner?.totalCommission ?? 0)}</strong>
              </div>
              <div className="list-row">
                <div><strong>Net profit</strong><div className="eyebrow">After expenses, costs, commissions</div></div>
                <strong className="trend-positive">{formatCurrency(summary.monthNetProfit)}</strong>
              </div>
              <div className="list-row">
                <div><strong>Total income earned</strong><div className="eyebrow">All recorded service income</div></div>
                <strong>{formatCurrency(summary.lifetimeRevenue)}</strong>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Monthly trend</h2>
              <p className="panel-copy">Revenue and commission history.</p>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Revenue</th>
                <th>Commission</th>
                <th>Services</th>
                <th>Clients</th>
              </tr>
            </thead>
            <tbody>
              {summary.monthlyTrend.map((row) => (
                <tr key={row.monthKey}>
                  <td><strong>{row.monthLabel}</strong></td>
                  <td>{formatCurrency(row.revenue)}</td>
                  <td>{formatCurrency(row.commission)}</td>
                  <td>{row.services}</td>
                  <td>{row.clients}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{isStaff ? 'Your reach' : 'Staff ranking'}</h2>
              <p className="panel-copy">{isStaff ? 'Client count and service volume.' : 'Revenue per staff member.'}</p>
            </div>
          </div>

          <div className="stack">
            {summary.topStaff.map((member) => (
              <div key={member.staffId} className="list-row">
                <div>
                  <strong>{member.staffName}</strong>
                  <div className="eyebrow">{member.totalServices} services / {member.clientCount} clients</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>{formatCurrency(member.totalRevenue)}</strong>
                  <div className="eyebrow">{formatCurrency(member.totalCommission)} commission</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Recent services</h2>
            <p className="panel-copy">Latest completed services.</p>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Service</th>
              <th>Staff</th>
              <th>Commission</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {summary.recentServices.map((record) => (
              <tr key={record.id}>
                <td>{record.customerName}</td>
                <td>{record.serviceName}</td>
                <td>{record.staffName}</td>
                <td>{formatCurrency(record.commission)}</td>
                <td>{formatDateTime(record.performedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
