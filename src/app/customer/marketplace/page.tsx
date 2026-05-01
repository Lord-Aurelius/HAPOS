import { CustomerShell } from '@/components/shell/customer-shell';
import { getSubscriptionDisplayName, subscriptionIncludesCustomerMarketplace } from '@/lib/plans';
import { requireCustomerSession } from '@/server/auth/customer-session';
import { listMarketplaceFeed } from '@/server/services/app-data';

export default async function CustomerMarketplacePage() {
  const session = await requireCustomerSession();
  const marketplaceEnabled = subscriptionIncludesCustomerMarketplace(session.subscription);
  const adverts = marketplaceEnabled ? await listMarketplaceFeed(session.tenant.id) : [];

  return (
    <CustomerShell session={session}>
      <section className="hero">
        <p className="hero-kicker">Marketplace</p>
        <h1 className="hero-title">Discover adverts from platinum businesses.</h1>
        <p className="hero-subtitle">
          Only customers of platinum tenants can see this shared marketplace board.
        </p>
      </section>

      {!marketplaceEnabled ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Marketplace not included</h2>
              <p className="panel-copy">
                Your shop is currently on the {getSubscriptionDisplayName(session.subscription)} package, so marketplace
                adverts are not part of your customer portal yet.
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Live marketplace board</h2>
              <p className="panel-copy">Browse approved adverts and contact the businesses directly.</p>
            </div>
            <span className="pill">{adverts.length} adverts</span>
          </div>

          <div className="marketplace-grid">
            {adverts.map((advert) => (
              <article className="marketplace-card" key={advert.id}>
                {advert.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={advert.imageUrl}
                    alt={advert.title}
                    className="marketplace-card-image"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="marketplace-card-placeholder">Marketplace advert</div>
                )}
                <div className="stack">
                  <div>
                    <div className="pill" style={{ marginBottom: 10 }}>{advert.tenantName}</div>
                    <h3 style={{ marginTop: 0 }}>{advert.title}</h3>
                    <p className="panel-copy">{advert.body}</p>
                  </div>
                  <div className="list-row">
                    <div>
                      <strong>{advert.contactName}</strong>
                      <div className="eyebrow">{advert.contactPhone}</div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </CustomerShell>
  );
}
