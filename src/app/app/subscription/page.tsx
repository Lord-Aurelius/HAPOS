import { formatCurrency, formatDate } from '@/lib/format';
import { getSubscriptionDisplayName, subscriptionIncludesMarketplace } from '@/lib/plans';
import { requireSession } from '@/server/auth/demo-session';
import { getCurrentSubscription } from '@/server/services/app-data';

export default async function SubscriptionPage() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const subscription = await getCurrentSubscription(session.tenant.id);
  if (!subscription) {
    return null;
  }

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Tenant billing</p>
        <h1 className="hero-title">Block access only when plan status says so.</h1>
        <p className="hero-subtitle">
          Protected HAPOS pages now enforce licence status and tenant suspension flags before a shop can continue working.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Current subscription</h2>
            <p className="panel-copy">This state is enforced in the backend before service entry, admin actions, and report access.</p>
          </div>
          <span className="pill">{subscription.status}</span>
        </div>

        <div className="dashboard-grid">
          <div className="tile">
            <span className="tile-label">Package</span>
            <div className="tile-value">{getSubscriptionDisplayName(subscription)}</div>
          </div>
          <div className="tile">
            <span className="tile-label">Amount</span>
            <div className="tile-value">{formatCurrency(subscription.amount)}</div>
          </div>
          <div className="tile">
            <span className="tile-label">Starts</span>
            <div className="tile-value" style={{ fontSize: '1.3rem' }}>
              {formatDate(subscription.startsAt)}
            </div>
          </div>
          <div className="tile">
            <span className="tile-label">Ends</span>
            <div className="tile-value" style={{ fontSize: '1.3rem' }}>
              {formatDate(subscription.endsAt)}
            </div>
          </div>
        </div>

        <div className="panel" style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>Package details</h3>
          <p className="panel-copy">{subscription.packageDescription ?? 'No package description recorded yet.'}</p>
          <div className="stack" style={{ gap: 10 }}>
            {(subscription.packageFeatures ?? []).map((feature) => (
              <span key={feature} className="pill">
                {feature}
              </span>
            ))}
          </div>
        </div>

        <div className="panel" style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>Payment terms</h3>
          <p className="panel-copy">{subscription.paymentTerms ?? 'No payment terms recorded yet.'}</p>
        </div>

        <div className="panel" style={{ marginTop: 20 }}>
          <h3 style={{ marginTop: 0 }}>Marketplace entitlement</h3>
          <p className="panel-copy">
            {subscriptionIncludesMarketplace(subscription)
              ? 'This tenant can publish adverts for approval and its customers can view the shared marketplace.'
              : 'This tenant is on a package without marketplace access, so marketplace publishing and customer marketplace access stay disabled.'}
          </p>
        </div>
      </section>
    </>
  );
}
