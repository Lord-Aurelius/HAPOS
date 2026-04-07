import { StatTile } from '@/components/ui/stat-tile';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { requireSession } from '@/server/auth/demo-session';
import { getDashboardSummary, getStaffMetrics } from '@/server/services/app-data';

function formatDelta(value: number) {
  if (value === 0) {
    return formatCurrency(0);
  }

  return `${value > 0 ? '+' : '-'}${formatCurrency(Math.abs(value))}`;
}

function getDeltaClass(value: number) {
  if (value > 0) {
    return 'trend-positive';
  }

  if (value < 0) {
    return 'trend-negative';
  }

  return 'trend-neutral';
}

export default async function DashboardPage() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const [summary, staffMetrics] = await Promise.all([
    getDashboardSummary(session),
    session.user.role === 'staff' ? getStaffMetrics(session.tenant.id, session.user.id) : Promise.resolve(null),
  ]);

  const revenueDelta = summary.monthRevenue - summary.previousMonthRevenue;
  const commissionDelta = summary.monthCommissionAccrued - summary.previousMonthCommissionAccrued;

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Shop dashboard</p>
        <h1 className="hero-title">{session.tenant.name}</h1>
        <p className="hero-subtitle">
          {session.user.role === 'staff'
            ? 'Your sales, commissions, and month-over-month contribution stay visible the moment you log in.'
            : 'Track shop income, staff output, commissions, and month-over-month momentum from one tenant-safe workspace.'}
        </p>
        {session.user.role !== 'staff' && summary.highestEarner ? (
          <div className="hero-actions">
            <span className="pill">
              Top revenue earner this month: {summary.highestEarner.staffName} / {formatCurrency(summary.highestEarner.totalRevenue)}
            </span>
          </div>
        ) : null}
      </section>

      <section className="dashboard-grid">
        {session.user.role === 'staff' && staffMetrics ? (
          <>
            <StatTile label="Today sales" value={formatCurrency(staffMetrics.todaySales)} />
            <StatTile label="This month sales" value={formatCurrency(staffMetrics.monthSales)} />
            <StatTile label="This month commission" value={formatCurrency(staffMetrics.monthCommission)} tone="success" />
            <StatTile label="Lifetime income" value={formatCurrency(summary.lifetimeRevenue)} />
          </>
        ) : (
          <>
            <StatTile label="Today revenue" value={formatCurrency(summary.todayRevenue)} />
            <StatTile label="This month revenue" value={formatCurrency(summary.monthRevenue)} />
            <StatTile label="This month commission" value={formatCurrency(summary.monthCommissionAccrued)} />
            <StatTile label="Total income earned" value={formatCurrency(summary.lifetimeRevenue)} tone="success" />
          </>
        )}
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Month comparison</h2>
              <p className="panel-copy">
                Compare the current month with the previous one across money generated and commission earned.
              </p>
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

          <div className="stack" style={{ marginTop: 20 }}>
            <div className="list-row">
              <div>
                <strong>Revenue change</strong>
                <div className="eyebrow">Current month versus previous month</div>
              </div>
              <strong className={getDeltaClass(revenueDelta)}>{formatDelta(revenueDelta)}</strong>
            </div>
            <div className="list-row">
              <div>
                <strong>Commission change</strong>
                <div className="eyebrow">Earned commission movement across the last two months</div>
              </div>
              <strong className={getDeltaClass(commissionDelta)}>{formatDelta(commissionDelta)}</strong>
            </div>
            <div className="list-row">
              <div>
                <strong>{session.user.role === 'staff' ? 'Lifetime commission' : 'All-time commission accrued'}</strong>
                <div className="eyebrow">Running total based on recorded service history</div>
              </div>
              <strong>{formatCurrency(summary.lifetimeCommission)}</strong>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{session.user.role === 'staff' ? 'Your month at a glance' : 'Top earner insight'}</h2>
              <p className="panel-copy">
                {session.user.role === 'staff'
                  ? 'Staff users only see their own numbers, clients, and earnings trajectory.'
                  : 'Quick read on who is leading the floor and how the shop is carrying margin this month.'}
              </p>
            </div>
          </div>

          {session.user.role === 'staff' && staffMetrics ? (
            <div className="stack">
              <div className="list-row">
                <div>
                  <strong>Clients this month</strong>
                  <div className="eyebrow">Unique customers handled by you</div>
                </div>
                <strong>{staffMetrics.monthClients}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Clients today</strong>
                  <div className="eyebrow">Customers served in your current shift</div>
                </div>
                <strong>{staffMetrics.todayClients}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>This month commission</strong>
                  <div className="eyebrow">What you have earned so far this month</div>
                </div>
                <strong style={{ color: 'var(--success)' }}>{formatCurrency(staffMetrics.monthCommission)}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Lifetime income</strong>
                  <div className="eyebrow">Total value of your recorded services</div>
                </div>
                <strong>{formatCurrency(summary.lifetimeRevenue)}</strong>
              </div>
            </div>
          ) : (
            <div className="stack">
              <div className="list-row">
                <div>
                  <strong>{summary.highestEarner?.staffName ?? 'No staff data yet'}</strong>
                  <div className="eyebrow">Highest revenue contributor this month</div>
                </div>
                <strong>{formatCurrency(summary.highestEarner?.totalRevenue ?? 0)}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Commission for top earner</strong>
                  <div className="eyebrow">Commission attached to the current revenue leader</div>
                </div>
                <strong>{formatCurrency(summary.highestEarner?.totalCommission ?? 0)}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Month net profit</strong>
                  <div className="eyebrow">Income after expenses, product costs, and paid commissions</div>
                </div>
                <strong style={{ color: 'var(--success)' }}>{formatCurrency(summary.monthNetProfit)}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Total income earned</strong>
                  <div className="eyebrow">All recorded service income for this shop</div>
                </div>
                <strong>{formatCurrency(summary.lifetimeRevenue)}</strong>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Contribution by month</h2>
            <p className="panel-copy">
              Revenue and commission history across the latest six months for {session.user.role === 'staff' ? 'your work' : 'the whole shop'}.
            </p>
          </div>
        </div>

        <table className="table trend-table">
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
                <td>
                  <strong>{row.monthLabel}</strong>
                </td>
                <td>{formatCurrency(row.revenue)}</td>
                <td>{formatCurrency(row.commission)}</td>
                <td>{row.services}</td>
                <td>{row.clients}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{session.user.role === 'staff' ? 'Your client reach' : 'Staff ranking this month'}</h2>
              <p className="panel-copy">
                {session.user.role === 'staff'
                  ? 'Client count and service volume help you understand your own output and earnings.'
                  : 'Revenue and commission stay visible per staff member for clean payroll and coaching conversations.'}
              </p>
            </div>
          </div>

          <div className="stack">
            {summary.topStaff.map((member) => (
              <div key={member.staffId} className="list-row">
                <div>
                  <strong>{member.staffName}</strong>
                  <div className="eyebrow">
                    {member.totalServices} services completed / {member.clientCount} clients
                  </div>
                </div>
                <div>
                  <strong>{formatCurrency(member.totalRevenue)}</strong>
                  <div className="eyebrow">{formatCurrency(member.totalCommission)} commission</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{session.user.role === 'staff' ? 'Your month at a glance' : 'Financial posture'}</h2>
              <p className="panel-copy">
                {session.user.role === 'staff'
                  ? 'Staff users only see their own money and client activity.'
                  : 'Net profit is derived from service income minus expenses, product costs, and commission payouts.'}
              </p>
            </div>
          </div>

          <div className="stack">
            <div className="list-row">
              <div>
                <strong>{session.user.role === 'staff' ? 'Clients this month' : 'Expenses this month'}</strong>
                <div className="eyebrow">{session.user.role === 'staff' ? 'Unique customers handled by you' : 'Operating outflow'}</div>
              </div>
              <strong>{session.user.role === 'staff' && staffMetrics ? staffMetrics.monthClients : formatCurrency(summary.monthExpenses)}</strong>
            </div>
            <div className="list-row">
              <div>
                <strong>{session.user.role === 'staff' ? 'Clients today' : 'Product costs'}</strong>
                <div className="eyebrow">{session.user.role === 'staff' ? "Today's served customers" : 'Usage recorded through service entries'}</div>
              </div>
              <strong>
                {session.user.role === 'staff' && staffMetrics ? staffMetrics.todayClients : formatCurrency(summary.monthProductCosts)}
              </strong>
            </div>
            <div className="list-row">
              <div>
                <strong>{session.user.role === 'staff' ? 'Month earnings' : 'Net profit'}</strong>
                <div className="eyebrow">{session.user.role === 'staff' ? 'Commission accrued from your work' : 'After payouts, product costs, and expenses'}</div>
              </div>
              <strong style={{ color: 'var(--success)' }}>
                {session.user.role === 'staff' && staffMetrics
                  ? formatCurrency(staffMetrics.monthCommission)
                  : formatCurrency(summary.monthNetProfit)}
              </strong>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Recent services</h2>
            <p className="panel-copy">Live feed of the tenant&apos;s latest completed services.</p>
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
