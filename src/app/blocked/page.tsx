import Link from 'next/link';
import { redirect } from 'next/navigation';

import { formatCurrency, formatDate } from '@/lib/format';
import { getAccessState } from '@/server/auth/access';
import { logoutAction } from '@/server/actions/hapos';
import { requireSession } from '@/server/auth/demo-session';

type BlockedPageProps = {
  searchParams: Promise<{ reason?: string }>;
};

export default async function BlockedPage({ searchParams }: BlockedPageProps) {
  const session = await requireSession(['shop_admin', 'staff'], { allowBlocked: true });
  const params = await searchParams;

  if (!session.tenant) {
    redirect('/login');
  }

  const accessState = getAccessState({
    tenantStatus: session.tenant.status,
    suspensionReason: session.tenant.suspensionReason,
    subscriptionStatus: session.subscription?.status,
    endsAt: session.subscription?.endsAt,
    graceEndsAt: session.subscription?.graceEndsAt,
  });

  if (!accessState.blocked) {
    redirect('/app/dashboard');
  }

  return (
    <main className="workspace">
      <div className="workspace-inner">
        <section className="hero">
          <p className="hero-kicker">Access blocked</p>
          <h1 className="hero-title">{session.tenant.name}</h1>
          <p className="hero-subtitle">
            {accessState.message} House Aurelius Point of Sale only restores access after the
            business is renewed or unsuspended.
          </p>
          <div className="hero-actions">
            <Link href="/login" className="button secondary">
              Back to login
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="button">
                Sign out
              </button>
            </form>
          </div>
        </section>

        <section className="dashboard-grid">
          <div className="tile">
            <span className="tile-label">Business status</span>
            <div className="tile-value" style={{ fontSize: '1.5rem' }}>
              {session.tenant.status}
            </div>
          </div>
          <div className="tile">
            <span className="tile-label">Licence status</span>
            <div className="tile-value" style={{ fontSize: '1.5rem' }}>
              {session.subscription?.status ?? 'missing'}
            </div>
          </div>
          <div className="tile">
            <span className="tile-label">Renewal date</span>
            <div className="tile-value" style={{ fontSize: '1.5rem' }}>
              {session.subscription?.endsAt ? formatDate(session.subscription.endsAt) : 'Not set'}
            </div>
          </div>
          <div className="tile">
            <span className="tile-label">Licence amount</span>
            <div className="tile-value" style={{ fontSize: '1.5rem' }}>
              {session.subscription ? formatCurrency(session.subscription.amount) : 'N/A'}
            </div>
          </div>
        </section>

        <section className="grid-two">
          <div className="panel">
            <h2>Why access is blocked</h2>
            <p className="panel-copy">
              {params.reason === 'tenant_suspended'
                ? 'The business itself has been suspended by the super admin.'
                : params.reason === 'subscription_expired'
                  ? 'The licence window has ended and needs a renewal.'
                  : params.reason === 'subscription_suspended'
                    ? 'The licence record is suspended even though the business exists.'
                    : params.reason === 'subscription_cancelled'
                      ? 'The licence was cancelled and must be replaced or renewed.'
                      : 'The account needs super-admin attention before the shop can continue using HAPOS.'}
            </p>
          </div>

          <div className="panel">
            <h2>Recorded payment terms</h2>
            <p className="panel-copy">
              {session.subscription?.paymentTerms?.trim() || 'No payment terms have been recorded for this shop yet.'}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
