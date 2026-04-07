import { reviewMarketplaceAdAction } from '@/server/actions/hapos';
import { listMarketplaceQueue } from '@/server/services/app-data';

type SuperMarketplacePageProps = {
  searchParams: Promise<{ success?: string }>;
};

function getMessage(success?: string) {
  if (success === 'approved') {
    return 'Marketplace advert approved and published.';
  }

  if (success === 'rejected') {
    return 'Marketplace advert rejected.';
  }

  return null;
}

export default async function SuperMarketplacePage({ searchParams }: SuperMarketplacePageProps) {
  const params = await searchParams;
  const adverts = await listMarketplaceQueue();

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Super admin marketplace</p>
        <h1 className="hero-title">Approve what goes live across platinum tenants.</h1>
        <p className="hero-subtitle">
          Shop admins can submit adverts, but only approved adverts appear in the shared marketplace board for platinum tenants and their customers.
        </p>
      </section>

      {getMessage(params.success) ? (
        <section className="panel">
          <span className="pill">{getMessage(params.success)}</span>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Marketplace moderation queue</h2>
            <p className="panel-copy">Pending adverts are shown first so you can publish or reject them quickly.</p>
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
                <div className="marketplace-card-placeholder">No advert image</div>
              )}

              <div className="stack">
                <div>
                  <div className="pill" style={{ marginBottom: 10 }}>
                    {advert.tenantName} / {advert.status}
                  </div>
                  <h3 style={{ marginTop: 0 }}>{advert.title}</h3>
                  <p className="panel-copy">{advert.body}</p>
                  <p className="eyebrow">
                    Contact: {advert.contactName} / {advert.contactPhone}
                  </p>
                  <p className="eyebrow">
                    Submitted by {advert.createdByName}
                    {advert.approvedByName ? ` / Reviewed by ${advert.approvedByName}` : ''}
                  </p>
                </div>

                <form action={reviewMarketplaceAdAction} className="field-grid">
                  <input type="hidden" name="adId" value={advert.id} />
                  <input type="hidden" name="redirectTo" value="/super/marketplace" />
                  <div className="field">
                    <label htmlFor={`approvalNotes-${advert.id}`}>Approval notes</label>
                    <textarea
                      id={`approvalNotes-${advert.id}`}
                      name="approvalNotes"
                      defaultValue={advert.approvalNotes ?? ''}
                    />
                  </div>
                  <div className="hero-actions">
                    <button type="submit" name="decision" value="approve" className="button">
                      Approve advert
                    </button>
                    <button type="submit" name="decision" value="reject" className="button secondary">
                      Reject advert
                    </button>
                  </div>
                </form>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
