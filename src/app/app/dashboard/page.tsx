import { StatTile } from '@/components/ui/stat-tile';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { requireSession } from '@/server/auth/demo-session';
import { getDashboardSummary, getStaffMetrics } from '@/server/services/app-data';

export default async function DashboardPage() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const [summary, staffMetrics] = await Promise.all([
    getDashboardSummary(session),
    session.user.role === 'staff' ? getStaffMetrics(session.tenant.id, session.user.id) : Promise.resolve(null),
  ]);

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Shop dashboard</p>
        <h1 className="hero-title">{session.tenant.name}</h1>
        <p className="hero-subtitle">
          {session.user.role === 'staff'
            ? 'Your daily and monthly sales, commissions, and client counts stay visible the moment you log in.'
            : 'Revenue, staff performance, commissions, and profitability stay tenant-scoped while the service-entry team keeps moving.'}
        </p>
      </section>

      <section className="dashboard-grid">
        {session.user.role === 'staff' && staffMetrics ? (
          <>
            <StatTile label="Today sales" value={formatCurrency(staffMetrics.todaySales)} />
            <StatTile label="Today earnings" value={formatCurrency(staffMetrics.todayCommission)} />
            <StatTile label="Month sales" value={formatCurrency(staffMetrics.monthSales)} />
            <StatTile label="Month earnings" value={formatCurrency(staffMetrics.monthCommission)} tone="success" />
          </>
        ) : (
          <>
            <StatTile label="Today revenue" value={formatCurrency(summary.todayRevenue)} />
            <StatTile label="Month revenue" value={formatCurrency(summary.monthRevenue)} />
            <StatTile label="Commission accrued" value={formatCurrency(summary.monthCommissionAccrued)} />
            <StatTile label="Month net profit" value={formatCurrency(summary.monthNetProfit)} tone="success" />
          </>
        )}
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{session.user.role === 'staff' ? 'Your client reach' : 'Staff ranking this month'}</h2>
              <p className="panel-copy">
                {session.user.role === 'staff'
                  ? 'Client count and service volume help staff understand their own output and earnings.'
                  : 'Commission and revenue stay visible per staff member for clean payroll conversations.'}
              </p>
            </div>
          </div>

          <div className="stack">
            {summary.topStaff.map((member) => (
              <div key={member.staffId} className="list-row">
                <div>
                  <strong>{member.staffName}</strong>
                  <div className="eyebrow">
                    {member.totalServices} services completed · {member.clientCount} clients
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
                <div className="eyebrow">{session.user.role === 'staff' ? 'Today’s served customers' : 'Usage recorded through service entries'}</div>
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
