import Link from 'next/link';

import { CustomerShell } from '@/components/shell/customer-shell';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { requireCustomerSession } from '@/server/auth/customer-session';
import { getCustomerPortalSummary } from '@/server/services/app-data';

export default async function CustomerDashboardPage() {
  const session = await requireCustomerSession();
  const data = await getCustomerPortalSummary(session.tenant.id, session.customer.id);

  return (
    <CustomerShell session={session}>
      <section className="hero">
        <p className="hero-kicker">My visits</p>
        <h1 className="hero-title">{session.tenant.name}</h1>
        <p className="hero-subtitle">
          Your visit count, who served you, what you spent, and what was done are all visible here.
        </p>
        <div className="hero-actions">
          <Link
            href={`/book/${session.tenant.slug}?phone=${encodeURIComponent(session.customer.phoneE164 || session.customer.phone)}`}
            className="button"
          >
            Book next visit
          </Link>
          <Link href="/customer/services" className="button secondary">
            See price list
          </Link>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="tile">
          <span className="tile-label">Total visits</span>
          <div className="tile-value">{data.summary.totalVisits}</div>
        </div>
        <div className="tile">
          <span className="tile-label">Lifetime spend</span>
          <div className="tile-value">{formatCurrency(data.summary.lifetimeValue, session.tenant.currencyCode)}</div>
        </div>
        <div className="tile">
          <span className="tile-label">This month</span>
          <div className="tile-value">{data.summary.thisMonthVisits}</div>
        </div>
        <div className="tile">
          <span className="tile-label">Month spend</span>
          <div className="tile-value">{formatCurrency(data.summary.thisMonthSpend, session.tenant.currencyCode)}</div>
        </div>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Loyalty progress</h2>
              <p className="panel-copy">Your reward progress is based on the same spend records the shop uses for reporting.</p>
            </div>
          </div>

          {data.loyalty.isEnabled ? (
            <div className="stack">
              <div className="list-row">
                <div>
                  <strong>Reward</strong>
                  <div className="eyebrow">{data.loyalty.rewardDescription}</div>
                </div>
                <strong>{data.loyalty.unlocked ? 'Unlocked' : `${data.loyalty.progressPercent}%`}</strong>
              </div>
              <div className="list-row">
                <div>
                  <strong>Spend target</strong>
                  <div className="eyebrow">{formatCurrency(data.loyalty.spendThreshold, session.tenant.currencyCode)}</div>
                </div>
                <div>
                  <strong>Remaining</strong>
                  <div className="eyebrow">{formatCurrency(data.loyalty.remainingAmount, session.tenant.currencyCode)}</div>
                </div>
              </div>
              <div className="panel" style={{ padding: 18 }}>
                <div className="eyebrow">Progress so far</div>
                <strong>{formatCurrency(data.loyalty.progressAmount, session.tenant.currencyCode)}</strong>
                <div className="eyebrow" style={{ marginTop: 8 }}>
                  {data.loyalty.notes || 'Ask the shop admin how the reward is redeemed once you unlock it.'}
                </div>
              </div>
            </div>
          ) : (
            <div className="panel" style={{ padding: 18 }}>
              <strong>Loyalty rewards are not active for this shop yet.</strong>
              <div className="eyebrow" style={{ marginTop: 8 }}>
                Your visits and spending are still being tracked, so the business can enable rewards later without losing your history.
              </div>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Recent requests</h2>
              <p className="panel-copy">Booking requests sent through the customer link appear here before the shop records the final service.</p>
            </div>
          </div>

          <div className="stack">
            {data.orders.length > 0 ? (
              data.orders.map((order) => (
                <div className="list-row" key={order.id}>
                  <div>
                    <strong>{order.serviceName}</strong>
                    <div className="eyebrow">
                      {order.requestedStaffName ? `Requested ${order.requestedStaffName}` : 'No staff preference'}
                    </div>
                    <div className="eyebrow">{order.notes || 'No request notes recorded.'}</div>
                  </div>
                  <div>
                    <strong>{order.status}</strong>
                    <div className="eyebrow">{formatDateTime(order.requestedAt)}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="eyebrow">No customer requests sent yet.</div>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Visit history</h2>
            <p className="panel-copy">This history is pulled from the same sales records the shop uses for commissions and reporting.</p>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Service</th>
              <th>Staff</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {data.records.map((record) => (
              <tr key={record.id}>
                <td>{formatDateTime(record.performedAt)}</td>
                <td>
                  <strong>{record.serviceName}</strong>
                  <div className="eyebrow">{record.description || 'No notes recorded.'}</div>
                </td>
                <td>{record.staffName}</td>
                <td>{formatCurrency(record.price, session.tenant.currencyCode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </CustomerShell>
  );
}
