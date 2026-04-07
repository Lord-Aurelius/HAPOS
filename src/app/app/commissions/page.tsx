import { formatCurrency } from '@/lib/format';
import { requireSession } from '@/server/auth/demo-session';
import { getStaffMetrics, getStaffPerformance, listCommissionPayouts, listUsers } from '@/server/services/app-data';

export default async function CommissionsPage() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const [performance, payouts, users] = await Promise.all([
    getStaffPerformance(session.tenant.id),
    listCommissionPayouts(session.tenant.id),
    listUsers(session.tenant.id),
  ]);
  const staffMetrics =
    session.user.role === 'staff' ? await getStaffMetrics(session.tenant.id, session.user.id) : null;
  const visiblePerformance =
    session.user.role === 'staff' ? performance.filter((row) => row.staffId === session.user.id) : performance;

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Commission engine</p>
        <h1 className="hero-title">Snapshot commissions when the service happens.</h1>
        <p className="hero-subtitle">
          Each service record stores its own commission amount so reports remain stable even after price-list or payout changes.
        </p>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{session.user.role === 'staff' ? 'Your commission summary' : 'Monthly staff performance'}</h2>
              <p className="panel-copy">
                {session.user.role === 'staff'
                  ? 'Staff only see their own revenue, client count, and commission totals.'
                  : 'Revenue and earned commissions by staff member.'}
              </p>
            </div>
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Services</th>
                <th>Revenue</th>
                <th>Commission</th>
              </tr>
            </thead>
            <tbody>
              {visiblePerformance.map((row) => (
                <tr key={row.staffId}>
                  <td>{row.staffName}</td>
                  <td>{row.totalServices}</td>
                  <td>{formatCurrency(row.totalRevenue)}</td>
                  <td>{formatCurrency(row.totalCommission)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{session.user.role === 'staff' ? 'Current pace' : 'Payout history'}</h2>
              <p className="panel-copy">
                {session.user.role === 'staff'
                  ? 'Quick look at your day and month so you know what you have earned so far.'
                  : 'Paid commissions are tracked separately from accrued commissions for cleaner profit math.'}
              </p>
            </div>
          </div>

          {session.user.role === 'staff' && staffMetrics ? (
            <div className="stack">
              <div className="list-row">
                <div>
                  <strong>Today</strong>
                  <div className="eyebrow">{staffMetrics.todayClients} clients</div>
                </div>
                <strong>{formatCurrency(staffMetrics.todayCommission)}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>This month</strong>
                  <div className="eyebrow">{staffMetrics.monthClients} clients</div>
                </div>
                <strong>{formatCurrency(staffMetrics.monthCommission)}</strong>
              </div>
            </div>
          ) : (
            <div className="stack">
              {payouts.map((payout) => {
                const staffName = users.find((user) => user.id === payout.staffId)?.fullName ?? payout.staffId;
                return (
                  <div className="list-row" key={payout.id}>
                    <div>
                      <strong>{staffName}</strong>
                      <div className="eyebrow">
                        {payout.periodStart} to {payout.periodEnd}
                      </div>
                    </div>
                    <strong>{formatCurrency(payout.amount)}</strong>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
