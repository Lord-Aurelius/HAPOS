import Link from 'next/link';

import { formatCurrency } from '@/lib/format';
import { requireSession } from '@/server/auth/demo-session';
import { updateLoyaltySettingsAction } from '@/server/actions/hapos';
import { buildCustomerBookingUrl, listCustomerLoyaltyProgress } from '@/server/services/app-data';

type LoyaltySettingsPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

function getFeedbackMessage(params: { success?: string; error?: string }) {
  if (params.error === 'threshold-required') {
    return 'Set a spending target above zero before enabling loyalty rewards.';
  }

  if (params.error === 'discount-required') {
    return 'Enter a subsidy amount above zero when the reward type is subsidized service.';
  }

  if (params.success === 'loyalty-saved') {
    return 'Loyalty settings saved.';
  }

  return null;
}

export default async function LoyaltySettingsPage({ searchParams }: LoyaltySettingsPageProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const tenant = session.tenant;

  const params = await searchParams;
  const loyaltyProgram = tenant.loyaltyProgram ?? {
    isEnabled: false,
    spendThreshold: 10000,
    rewardType: 'free_service' as const,
    rewardValue: 0,
    rewardLabel: 'Complimentary service',
    notes: null,
  };
  const bookingUrl = buildCustomerBookingUrl(tenant.slug);
  const customerProgress = await listCustomerLoyaltyProgress(tenant.id);

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Customer growth</p>
        <h1 className="hero-title">Share one booking link and make loyalty visible.</h1>
        <p className="hero-subtitle">
          Customers use the dedicated link to request a service with their phone number, and that same phone number becomes their customer-portal login for spend and attendance tracking.
        </p>
      </section>

      {getFeedbackMessage(params) ? (
        <section className="panel">
          <span
            className="pill"
            style={params.error ? { background: 'rgba(160, 60, 46, 0.12)', color: 'var(--danger)' } : undefined}
          >
            {getFeedbackMessage(params)}
          </span>
        </section>
      ) : null}

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Shareable customer booking link</h2>
              <p className="panel-copy">This link lets customers choose a service, leave their phone number, and request the staff member they prefer.</p>
            </div>
          </div>

          <div className="stack">
            <div className="panel" style={{ padding: 18 }}>
              <strong>{tenant.name}</strong>
              <div className="eyebrow" style={{ marginTop: 6 }}>{bookingUrl}</div>
            </div>
            <div className="hero-actions">
              <Link href={`/book/${tenant.slug}`} className="button">
                Open booking page
              </Link>
              <Link href="/customer/login" className="button secondary">
                Open customer login
              </Link>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Loyalty reward rules</h2>
              <p className="panel-copy">Set the spend target that unlocks either a complimentary service or a subsidized one.</p>
            </div>
          </div>

          <form action={updateLoyaltySettingsAction} className="field-grid">
            <input type="hidden" name="redirectTo" value="/app/settings/loyalty?success=loyalty-saved" />
            <label className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                name="isEnabled"
                defaultChecked={loyaltyProgram.isEnabled}
                style={{ width: 18, minHeight: 18 }}
              />
              Enable customer loyalty rewards
            </label>
            <div className="field">
              <label htmlFor="spendThreshold">Spend target</label>
              <input
                id="spendThreshold"
                name="spendThreshold"
                type="number"
                min="0"
                step="1"
                defaultValue={loyaltyProgram.spendThreshold}
              />
            </div>
            <div className="field">
              <label htmlFor="rewardType">Reward type</label>
              <select id="rewardType" name="rewardType" defaultValue={loyaltyProgram.rewardType}>
                <option value="free_service">Free service</option>
                <option value="subsidized_service">Subsidized service</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="rewardValue">Subsidy amount</label>
              <input
                id="rewardValue"
                name="rewardValue"
                type="number"
                min="0"
                step="1"
                defaultValue={loyaltyProgram.rewardValue}
              />
            </div>
            <div className="field">
              <label htmlFor="rewardLabel">Reward label</label>
              <input
                id="rewardLabel"
                name="rewardLabel"
                defaultValue={loyaltyProgram.rewardLabel ?? ''}
                placeholder="Complimentary service or KES 500 loyalty credit"
              />
            </div>
            <div className="field">
              <label htmlFor="notes">Notes shown to admins</label>
              <textarea
                id="notes"
                name="notes"
                defaultValue={loyaltyProgram.notes ?? ''}
                placeholder="Explain how the reward should be honored at the counter."
              />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Save loyalty rules
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Customer loyalty progress</h2>
            <p className="panel-copy">This table shows who is closest to the reward target and who has already unlocked it.</p>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Phone</th>
              <th>Visits</th>
              <th>Lifetime spend</th>
              <th>Remaining</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {customerProgress.map((row) => (
              <tr key={row.customer.id}>
                <td>{row.customer.name}</td>
                <td>{row.customer.phoneE164}</td>
                <td>{row.totalVisits}</td>
                <td>{formatCurrency(row.lifetimeValue, tenant.currencyCode)}</td>
                <td>{formatCurrency(row.remainingAmount, tenant.currencyCode)}</td>
                <td>{row.unlocked ? 'Reward unlocked' : `${row.progressPercent}% to target`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
