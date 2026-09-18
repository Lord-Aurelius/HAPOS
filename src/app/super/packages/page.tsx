import { addSubscriptionPackageAction, updateSubscriptionPackageAction } from '@/server/actions/hapos';
import { formatCurrency } from '@/lib/format';
import { listSubscriptionPackages } from '@/server/services/app-data';

type PackagesPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

function getFeedbackMessage(params: { success?: string; error?: string }) {
  if (params.error === 'package-exists') return 'That package code or package name already exists.';
  if (params.error === 'package-required') return 'Enter a package name before saving.';
  if (params.success === 'package-added') return 'New package created.';
  if (params.success === 'package-updated') return 'Package updated.';
  return 'Package update saved.';
}

export default async function SuperPackagesPage({ searchParams }: PackagesPageProps) {
  const params = await searchParams;
  const subscriptionPackages = await listSubscriptionPackages();

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Super admin</p>
        <h1 className="hero-title">Packages.</h1>
        <p className="hero-subtitle">
          Create, price, and edit the packages that tenants can be assigned to. Marketplace access is controlled here, not hard-coded.
        </p>
      </section>

      {params.success || params.error ? (
        <section className="panel">
          <span className="pill">{getFeedbackMessage(params)}</span>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Create package</h2>
          </div>
        </div>

        <form action={addSubscriptionPackageAction} className="field-grid" style={{ marginBottom: 24 }}>
          <input type="hidden" name="redirectTo" value="/super/packages" />
          <div className="field">
            <label htmlFor="package-name">Package name</label>
            <input id="package-name" name="name" placeholder="Gold Plus" required />
          </div>
          <div className="field">
            <label htmlFor="package-code">Package code</label>
            <input id="package-code" name="code" placeholder="gold-plus" />
          </div>
          <div className="field">
            <label htmlFor="package-amount">Package amount</label>
            <input id="package-amount" name="amount" type="number" min="0" step="1" defaultValue="0" />
          </div>
          <div className="field">
            <label htmlFor="package-currency">Currency</label>
            <input id="package-currency" name="currencyCode" defaultValue="KES" />
          </div>
          <div className="field">
            <label htmlFor="package-period">Billing period</label>
            <select id="package-period" name="billingPeriod" defaultValue="monthly">
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="annual">Annual</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="package-description">Description</label>
            <textarea id="package-description" name="description" placeholder="Summarise what this package is for." />
          </div>
          <div className="field">
            <label htmlFor="package-features">Package features</label>
            <textarea
              id="package-features"
              name="features"
              placeholder={'One feature per line\nDashboard and reports\nMarketplace board'}
            />
          </div>
          <div className="field">
            <label className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <input type="checkbox" name="includesMarketplace" style={{ width: 18, minHeight: 18 }} />
              Shops on this package can use the marketplace
            </label>
            <label className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
              <input type="checkbox" name="includesCustomerMarketplace" style={{ width: 18, minHeight: 18 }} />
              Customers on this package can see the marketplace
            </label>
            <label className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" name="isActive" defaultChecked style={{ width: 18, minHeight: 18 }} />
              Package is active for new assignments
            </label>
          </div>
          <div className="hero-actions">
            <button type="submit" className="button">
              Create package
            </button>
          </div>
        </form>

        <div className="stack">
          {subscriptionPackages.map((subscriptionPackage) => (
            <form action={updateSubscriptionPackageAction} className="panel" style={{ padding: 20 }} key={subscriptionPackage.id}>
              <input type="hidden" name="packageId" value={subscriptionPackage.id} />
              <input type="hidden" name="redirectTo" value="/super/packages" />
              <div className="panel-header">
                <div>
                  <h3 style={{ marginTop: 0 }}>{subscriptionPackage.name}</h3>
                  <p className="panel-copy">
                    Code: {subscriptionPackage.code} / {formatCurrency(subscriptionPackage.amount)} / {subscriptionPackage.billingPeriod}
                  </p>
                </div>
                <span className="pill">{subscriptionPackage.isActive ? 'active' : 'inactive'}</span>
              </div>

              <div className="field-grid">
                <div className="field">
                  <label htmlFor={`package-name-${subscriptionPackage.id}`}>Package name</label>
                  <input id={`package-name-${subscriptionPackage.id}`} name="name" defaultValue={subscriptionPackage.name} required />
                </div>
                <div className="field">
                  <label htmlFor={`package-code-${subscriptionPackage.id}`}>Package code</label>
                  <input id={`package-code-${subscriptionPackage.id}`} name="code" defaultValue={subscriptionPackage.code} required />
                </div>
                <div className="field">
                  <label htmlFor={`package-amount-${subscriptionPackage.id}`}>Package amount</label>
                  <input
                    id={`package-amount-${subscriptionPackage.id}`}
                    name="amount"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={subscriptionPackage.amount}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`package-currency-${subscriptionPackage.id}`}>Currency</label>
                  <input
                    id={`package-currency-${subscriptionPackage.id}`}
                    name="currencyCode"
                    defaultValue={subscriptionPackage.currencyCode}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`package-period-${subscriptionPackage.id}`}>Billing period</label>
                  <select
                    id={`package-period-${subscriptionPackage.id}`}
                    name="billingPeriod"
                    defaultValue={subscriptionPackage.billingPeriod}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annual">Annual</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`package-description-${subscriptionPackage.id}`}>Description</label>
                  <textarea
                    id={`package-description-${subscriptionPackage.id}`}
                    name="description"
                    defaultValue={subscriptionPackage.description ?? ''}
                  />
                </div>
                <div className="field">
                  <label htmlFor={`package-features-${subscriptionPackage.id}`}>Package features</label>
                  <textarea
                    id={`package-features-${subscriptionPackage.id}`}
                    name="features"
                    defaultValue={subscriptionPackage.features.join('\n')}
                  />
                </div>
                <div className="field">
                  <label className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                    <input
                      type="checkbox"
                      name="includesMarketplace"
                      defaultChecked={subscriptionPackage.includesMarketplace}
                      style={{ width: 18, minHeight: 18 }}
                    />
                    Shops can use marketplace
                  </label>
                  <label className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                    <input
                      type="checkbox"
                      name="includesCustomerMarketplace"
                      defaultChecked={subscriptionPackage.includesCustomerMarketplace}
                      style={{ width: 18, minHeight: 18 }}
                    />
                    Customers can view marketplace
                  </label>
                  <label className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      name="isActive"
                      defaultChecked={subscriptionPackage.isActive}
                      style={{ width: 18, minHeight: 18 }}
                    />
                    Available for new tenant assignments
                  </label>
                </div>
              </div>

              <div className="hero-actions">
                <button type="submit" className="button secondary">
                  Save package
                </button>
              </div>
            </form>
          ))}
        </div>
      </section>
    </>
  );
}
