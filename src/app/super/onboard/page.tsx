import { addTenantAction } from '@/server/actions/hapos';
import { formatCurrency } from '@/lib/format';
import { listSubscriptionPackages } from '@/server/services/app-data';

type OnboardPageProps = {
  searchParams: Promise<{ success?: string; error?: string; tenantId?: string }>;
};

function getFeedbackMessage(params: { success?: string; error?: string }) {
  if (params.error === 'tenant-exists') return 'That business slug already exists.';
  if (params.error === 'logo-upload') return 'Upload a valid image file for the business logo.';
  if (params.success === 'tenant-added') return 'New tenant created.';
  return 'Shop onboarding saved.';
}

export default async function SuperOnboardPage({ searchParams }: OnboardPageProps) {
  const params = await searchParams;
  const subscriptionPackages = await listSubscriptionPackages();

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Super admin</p>
        <h1 className="hero-title">Onboard a shop.</h1>
        <p className="hero-subtitle">
          Every new business becomes its own tenant with separate users, data, reports, and licence controls.
        </p>
      </section>

      {params.success || params.error ? (
        <section className="panel">
          <span className="pill">{getFeedbackMessage(params)}</span>
          {params.success === 'tenant-added' && params.tenantId ? (
            <div className="hero-actions" style={{ marginTop: 12 }}>
              <a className="button secondary" href={`/super/tenants/${params.tenantId}`}>
                Open tenant workspace
              </a>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Add new shop</h2>
            <p className="panel-copy">Fill in the business profile, package, and licence window.</p>
          </div>
        </div>

        <form action={addTenantAction} className="field-grid">
          <input type="hidden" name="redirectTo" value="/super/onboard" />
          <div className="field">
            <label htmlFor="name">Business name</label>
            <input id="name" name="name" required />
          </div>
          <div className="field">
            <label htmlFor="ownerName">Owner name</label>
            <input id="ownerName" name="ownerName" />
          </div>
          <div className="field">
            <label htmlFor="storeNumber">Store number</label>
            <input id="storeNumber" name="storeNumber" placeholder="Shop 14, 1st Floor" />
          </div>
          <div className="field">
            <label htmlFor="slug">Business slug</label>
            <input id="slug" name="slug" required />
          </div>
          <div className="field">
            <label htmlFor="logoFile">Business logo from this computer</label>
            <input id="logoFile" name="logoFile" type="file" accept="image/*" />
          </div>
          <div className="field">
            <label htmlFor="packageId">Package</label>
            <select id="packageId" name="packageId" defaultValue={subscriptionPackages.find((item) => item.code === 'basic')?.id}>
              {subscriptionPackages
                .filter((item) => item.isActive)
                .map((subscriptionPackage) => (
                  <option key={subscriptionPackage.id} value={subscriptionPackage.id}>
                    {subscriptionPackage.name} / {formatCurrency(subscriptionPackage.amount)}
                  </option>
                ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="currencyCode">Currency</label>
            <input id="currencyCode" name="currencyCode" defaultValue="KES" />
          </div>
          <div className="field">
            <label htmlFor="amount">Licence amount</label>
            <input id="amount" name="amount" type="number" min="0" step="1" placeholder="Leave blank to use the package amount" />
          </div>
          <div className="field">
            <label htmlFor="endsAt">Ends at</label>
            <input id="endsAt" name="endsAt" type="datetime-local" />
          </div>
          <div className="field">
            <label htmlFor="motto">Business motto</label>
            <textarea id="motto" name="motto" placeholder="Sharp cuts, polished confidence." />
          </div>
          <div className="field">
            <label htmlFor="address">Business address</label>
            <textarea id="address" name="address" placeholder="Kimathi House, 2nd Floor, Nairobi" />
          </div>
          <div className="field">
            <label htmlFor="paymentTerms">Payment terms</label>
            <textarea id="paymentTerms" name="paymentTerms" placeholder="Example: monthly fee due by the 5th" />
          </div>
          <div className="hero-actions">
            <button type="submit" className="button">
              Add tenant
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
