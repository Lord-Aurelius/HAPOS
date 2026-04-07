import { formatDateTime } from '@/lib/format';
import { getSubscriptionDisplayName, subscriptionIncludesMarketplace } from '@/lib/plans';
import { addMarketplaceAdAction } from '@/server/actions/hapos';
import { requireSession } from '@/server/auth/demo-session';
import { getCurrentSubscription, listMarketplaceFeed } from '@/server/services/app-data';

type MarketplacePageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

function getMessage(params: { success?: string; error?: string }) {
  if (params.error === 'image-upload') {
    return 'Upload a valid image for the advertisement before saving it.';
  }

  if (params.success === 'submitted') {
    return 'Marketplace advert submitted. It will go live after super-admin approval.';
  }

  return null;
}

export default async function MarketplacePage({ searchParams }: MarketplacePageProps) {
  const session = await requireSession(['shop_admin', 'staff']);
  if (!session.tenant) {
    return null;
  }

  const params = await searchParams;
  const subscription = await getCurrentSubscription(session.tenant.id);
  const marketplaceEnabled = subscriptionIncludesMarketplace(subscription);
  const adverts = marketplaceEnabled ? await listMarketplaceFeed(session.tenant.id, session.user.role === 'shop_admin') : [];

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Marketplace</p>
        <h1 className="hero-title">Promote trusted offers across platinum shops.</h1>
        <p className="hero-subtitle">
          Platinum businesses can publish approved adverts that staff and customers across platinum tenants can browse.
          Basic plans do not include this board.
        </p>
      </section>

      {getMessage(params) ? (
        <section className="panel">
          <span className="pill">{getMessage(params)}</span>
        </section>
      ) : null}

      {!marketplaceEnabled ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Marketplace locked</h2>
              <p className="panel-copy">
                Your current package is {getSubscriptionDisplayName(subscription)}. Ask the super admin to switch this
                tenant to a package that includes marketplace access.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {marketplaceEnabled && session.user.role === 'shop_admin' ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Submit a new advert</h2>
              <p className="panel-copy">Only the shop admin can submit adverts, and each advert waits for super-admin approval before it is published.</p>
            </div>
          </div>

          <form action={addMarketplaceAdAction} className="field-grid">
            <div className="field">
              <label htmlFor="title">Advert title</label>
              <input id="title" name="title" required />
            </div>
            <div className="field">
              <label htmlFor="contactName">Contact name</label>
              <input id="contactName" name="contactName" defaultValue={session.user.fullName} />
            </div>
            <div className="field">
              <label htmlFor="contactPhone">Contact phone</label>
              <input id="contactPhone" name="contactPhone" defaultValue={session.user.phone ?? ''} required />
            </div>
            <div className="field">
              <label htmlFor="body">Advert details</label>
              <textarea id="body" name="body" required />
            </div>
            <div className="field">
              <label htmlFor="imageFile">Advert photo from this computer</label>
              <input id="imageFile" name="imageFile" type="file" accept="image/*" />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Submit advert
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {marketplaceEnabled ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Approved marketplace board</h2>
              <p className="panel-copy">This feed is shared across platinum subscribers and their customers.</p>
            </div>
            <span className="pill">{adverts.length} adverts</span>
          </div>

          <div className="marketplace-grid">
            {adverts.map((advert) => (
              <article className="marketplace-card" key={advert.id}>
                {advert.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={advert.imageUrl} alt={advert.title} className="marketplace-card-image" />
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
                    <div className="eyebrow">
                      {advert.status}
                      <br />
                      {formatDateTime(advert.createdAt)}
                    </div>
                  </div>
                  {advert.isOwnAd && advert.status !== 'approved' ? (
                    <span className="pill">
                      {advert.status === 'pending' ? 'Waiting for super-admin approval' : 'Rejected'}
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
