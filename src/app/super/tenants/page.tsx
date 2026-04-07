import {
  addSubscriptionPackageAction,
  addTenantAction,
  addUserAction,
  clearTenantCustomersAction,
  setUserPasswordAction,
  setUserStatusAction,
  suspendTenantAction,
  updateSubscriptionPackageAction,
  updateTenantSubscriptionAction,
  updateTenantBrandingAction,
} from '@/server/actions/hapos';
import { BusinessAvatar } from '@/components/tenant/business-avatar';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format';
import { getSubscriptionDisplayName } from '@/lib/plans';
import { listSubscriptionPackages, listSubscriptions, listTenants } from '@/server/services/app-data';
import { getPlatformOverview, listCredentialRecordsForTenant } from '@/server/services/admin-tools';

type SuperTenantsPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

function getFeedbackMessage(params: { success?: string; error?: string }) {
  if (params.error === 'tenant-exists') return 'That business slug already exists.';
  if (params.error === 'user-exists') return 'That username or email already exists for the selected shop.';
  if (params.error === 'password-required') return 'Enter a password before saving.';
  if (params.error === 'logo-upload') return 'Upload a valid image file for the business logo.';
  if (params.error === 'package-exists') return 'That package code or package name already exists.';
  if (params.error === 'package-required') return 'Enter a package name before saving.';
  if (params.success === 'tenant-added') return 'New tenant created.';
  if (params.success === 'package-added') return 'New package created.';
  if (params.success === 'package-updated') return 'Package updated.';
  if (params.success === 'user-added') return 'Tenant login created.';
  if (params.success === 'password-updated') return 'Password updated.';
  if (params.success === 'user-status') return 'User access updated.';
  if (params.success === 'branding-updated') return 'Business profile updated for receipts and reports.';
  if (params.success === 'renewed') return 'Licence renewed.';
  if (params.success === 'subscription-updated') return 'Tenant subscription updated.';
  if (params.success === 'suspended') return 'Tenant suspended.';
  if (params.success === 'cleared') return 'Customer, service, SMS, expense, and commission records cleared for that shop.';
  return 'Command center update saved.';
}

export default async function SuperTenantsPage({ searchParams }: SuperTenantsPageProps) {
  const params = await searchParams;
  const [tenants, subscriptions, subscriptionPackages, platformOverview] = await Promise.all([
    listTenants(),
    listSubscriptions(),
    listSubscriptionPackages(),
    getPlatformOverview(),
  ]);
  const credentialGroups = await Promise.all(
    tenants.map(async (tenant) => ({
      tenantId: tenant.id,
      credentials: await listCredentialRecordsForTenant(tenant.id),
    })),
  );

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Super admin</p>
        <h1 className="hero-title">HAPOS command center.</h1>
        <p className="hero-subtitle">
          Run the platform from one place: onboard shops, manage licence status, recover employee access, and inspect tenant
          performance without breaking tenant isolation.
        </p>
        <div className="hero-actions">
          <a href="/super/marketplace" className="button secondary">
            Open marketplace approvals
          </a>
        </div>
      </section>

      {params.success || params.error ? (
        <section className="panel">
          <span className="pill">{getFeedbackMessage(params)}</span>
        </section>
      ) : null}

      <section className="dashboard-grid">
        <div className="tile">
          <span className="tile-label">Tenant shops</span>
          <div className="tile-value">{platformOverview.tenantCount}</div>
        </div>
        <div className="tile">
          <span className="tile-label">Active shops</span>
          <div className="tile-value">{platformOverview.activeTenantCount}</div>
        </div>
        <div className="tile">
          <span className="tile-label">Month revenue</span>
          <div className="tile-value">{formatCurrency(platformOverview.monthRevenue)}</div>
        </div>
        <div className="tile">
          <span className="tile-label">All-time revenue</span>
          <div className="tile-value">{formatCurrency(platformOverview.allTimeRevenue)}</div>
        </div>
        <div className="tile">
          <span className="tile-label">Customers tracked</span>
          <div className="tile-value">{platformOverview.totalCustomers}</div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Add new shop</h2>
            <p className="panel-copy">Every new business becomes its own tenant with separate users, data, reports, and licence controls.</p>
          </div>
          <div className="hero-actions" style={{ marginTop: 0 }}>
            <a href="/api/v1/reports/export?scope=platform&format=json" className="button secondary">
              Export platform JSON
            </a>
            <a href="/api/v1/reports/export?scope=platform&format=csv" className="button secondary">
              Export platform CSV
            </a>
          </div>
        </div>

        <form action={addTenantAction} className="field-grid">
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

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Package studio</h2>
            <p className="panel-copy">
              Create, price, and edit the packages that tenants can be assigned to. Marketplace access is controlled here, not hard-coded.
            </p>
          </div>
        </div>

        <form action={addSubscriptionPackageAction} className="field-grid" style={{ marginBottom: 24 }}>
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

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Portfolio view</h2>
            <p className="panel-copy">
              Compare tenant performance across revenue, customer base, and product usage so you can price, support, and expand HAPOS strategically.
            </p>
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Shop</th>
              <th>Month revenue</th>
              <th>All-time revenue</th>
              <th>Customers</th>
              <th>Employees</th>
              <th>Top products</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {platformOverview.tenantRows.map((tenant) => (
              <tr key={tenant.tenantId}>
                <td>
                  <strong>{tenant.tenantName}</strong>
                  <div className="eyebrow">
                    Owner: {tenant.ownerName} / Slug: {tenant.slug} / Licence ends{' '}
                    {tenant.licenceEndsAt ? formatDate(tenant.licenceEndsAt) : '-'}
                  </div>
                  <div className="eyebrow">
                    {tenant.storeNumber ? `Store ${tenant.storeNumber}` : 'Store not set'} / {tenant.address ?? 'Address not set'}
                  </div>
                </td>
                <td>{formatCurrency(tenant.monthRevenue)}</td>
                <td>{formatCurrency(tenant.allTimeRevenue)}</td>
                <td>{tenant.customerCount}</td>
                <td>{tenant.employeeCount}</td>
                <td>
                  {tenant.topProducts.length > 0
                    ? tenant.topProducts.map((product) => `${product.productName} (${product.quantity})`).join(', ')
                    : 'No product usage yet'}
                </td>
                <td>{tenant.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="stack">
        {tenants.map((tenant) => {
          const subscription = subscriptions.find((item) => item.tenantId === tenant.id);
          const tenantOverview = platformOverview.tenantRows.find((row) => row.tenantId === tenant.id);
          const credentials = credentialGroups.find((group) => group.tenantId === tenant.id)?.credentials ?? [];

          return (
            <section className="panel" key={tenant.id}>
              <div className="panel-header">
                <div>
                  <h2>{tenant.name}</h2>
                  <p className="panel-copy">
                    Owner: {tenant.ownerName ?? 'Not set'} / Business slug: {tenant.slug} / Licence status:{' '}
                    {subscription?.status ?? 'unknown'}
                  </p>
                  <p className="eyebrow">
                    Package: {getSubscriptionDisplayName(subscription)} / {tenant.storeNumber ? `Store ${tenant.storeNumber}` : 'Store number not set'} /{' '}
                    {tenant.address ?? 'Address not set'}
                  </p>
                </div>
                <span className="pill">{tenant.status}</span>
              </div>

              <div className="dashboard-grid" style={{ marginBottom: 20 }}>
                <div className="tile">
                  <span className="tile-label">Month revenue</span>
                  <div className="tile-value">{formatCurrency(tenantOverview?.monthRevenue ?? 0)}</div>
                </div>
                <div className="tile">
                  <span className="tile-label">All-time revenue</span>
                  <div className="tile-value">{formatCurrency(tenantOverview?.allTimeRevenue ?? 0)}</div>
                </div>
                <div className="tile">
                  <span className="tile-label">Customers</span>
                  <div className="tile-value">{tenantOverview?.customerCount ?? 0}</div>
                </div>
                <div className="tile">
                  <span className="tile-label">Employees</span>
                  <div className="tile-value">{tenantOverview?.employeeCount ?? 0}</div>
                </div>
              </div>

              <div className="grid-two">
                <div className="stack">
                  <form action={updateTenantBrandingAction} className="panel" style={{ padding: 20 }}>
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <div className="panel-header">
                      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                        <BusinessAvatar tenant={tenant} size="lg" />
                        <div>
                          <h3 style={{ marginTop: 0 }}>Business profile for receipts and reports</h3>
                          <p className="panel-copy">
                            Set the logo, motto, address, and store number that HAPOS will print on branded shop documents.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="field-grid">
                      <div className="field">
                        <label htmlFor={`tenant-name-${tenant.id}`}>Business name</label>
                        <input id={`tenant-name-${tenant.id}`} name="name" defaultValue={tenant.name} required />
                      </div>
                      <div className="field">
                        <label htmlFor={`tenant-owner-${tenant.id}`}>Owner name</label>
                        <input id={`tenant-owner-${tenant.id}`} name="ownerName" defaultValue={tenant.ownerName ?? ''} />
                      </div>
                      <div className="field">
                        <label htmlFor={`tenant-store-${tenant.id}`}>Store number</label>
                        <input id={`tenant-store-${tenant.id}`} name="storeNumber" defaultValue={tenant.storeNumber ?? ''} />
                      </div>
                      <div className="field">
                        <label htmlFor={`tenant-logo-${tenant.id}`}>Upload new logo</label>
                        <input id={`tenant-logo-${tenant.id}`} name="logoFile" type="file" accept="image/*" />
                      </div>
                      <div className="field">
                        <label htmlFor={`tenant-motto-${tenant.id}`}>Motto</label>
                        <textarea id={`tenant-motto-${tenant.id}`} name="motto" defaultValue={tenant.motto ?? ''} />
                      </div>
                      <div className="field">
                        <label htmlFor={`tenant-address-${tenant.id}`}>Address</label>
                        <textarea id={`tenant-address-${tenant.id}`} name="address" defaultValue={tenant.address ?? ''} />
                      </div>
                    </div>
                    <label className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="checkbox" name="removeLogo" style={{ width: 18, minHeight: 18 }} />
                      Remove current logo
                    </label>
                    <div className="hero-actions">
                      <button type="submit" className="button">
                        Save business profile
                      </button>
                    </div>
                  </form>

                  <div className="panel" style={{ padding: 20 }}>
                    <h3 style={{ marginTop: 0 }}>Licence and archive controls</h3>
                    <div className="stack" style={{ gap: 12 }}>
                      <div className="list-row">
                        <div>
                          <strong>Assigned package</strong>
                          <div className="eyebrow">
                            {getSubscriptionDisplayName(subscription)}
                            {subscription?.billingPeriod ? ` / ${subscription.billingPeriod}` : ''}
                          </div>
                          <div className="eyebrow">
                            {(subscription?.packageFeatures ?? []).length
                              ? subscription?.packageFeatures?.join(', ')
                              : 'No package features recorded yet.'}
                          </div>
                        </div>
                      </div>
                      <div className="list-row">
                        <div>
                          <strong>Payment terms</strong>
                          <div className="eyebrow">{subscription?.paymentTerms || 'No payment terms saved yet.'}</div>
                        </div>
                      </div>
                      <div className="list-row">
                        <div>
                          <strong>Most used products</strong>
                          <div className="eyebrow">
                            {tenantOverview?.topProducts.length
                              ? tenantOverview.topProducts
                                  .map((product) => `${product.productName} (${product.quantity}, ${formatCurrency(product.totalCost)})`)
                                  .join(', ')
                              : 'No product usage recorded yet.'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <form action={suspendTenantAction} className="field-grid">
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <div className="field">
                      <label htmlFor={`reason-${tenant.id}`}>Suspend reason</label>
                      <textarea id={`reason-${tenant.id}`} name="reason" defaultValue={tenant.suspensionReason ?? ''} />
                    </div>
                    <div className="hero-actions">
                      <button type="submit" className="button secondary">Suspend tenant</button>
                    </div>
                  </form>

                  <form action={updateTenantSubscriptionAction} className="field-grid">
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <div className="field">
                      <label htmlFor={`tenant-package-${tenant.id}`}>Assigned package</label>
                      <select
                        id={`tenant-package-${tenant.id}`}
                        name="packageId"
                        defaultValue={subscription?.packageId ?? subscriptionPackages.find((item) => item.code === subscription?.planCode)?.id}
                      >
                        {subscriptionPackages.map((subscriptionPackage) => (
                          <option key={subscriptionPackage.id} value={subscriptionPackage.id}>
                            {subscriptionPackage.name} / {formatCurrency(subscriptionPackage.amount)} / {subscriptionPackage.billingPeriod}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`tenant-status-${tenant.id}`}>Subscription status</label>
                      <select id={`tenant-status-${tenant.id}`} name="status" defaultValue={subscription?.status ?? 'active'}>
                        <option value="trialing">Trialing</option>
                        <option value="active">Active</option>
                        <option value="past_due">Past due</option>
                        <option value="expired">Expired</option>
                        <option value="suspended">Suspended</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`tenant-amount-${tenant.id}`}>Billed amount</label>
                      <input
                        id={`tenant-amount-${tenant.id}`}
                        name="amount"
                        type="number"
                        min="0"
                        step="1"
                        defaultValue={subscription?.amount ?? 0}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`tenant-currency-${tenant.id}`}>Currency</label>
                      <input id={`tenant-currency-${tenant.id}`} name="currencyCode" defaultValue={subscription?.currencyCode ?? tenant.currencyCode} />
                    </div>
                    <div className="field">
                      <label htmlFor={`startsAt-${tenant.id}`}>Subscription start</label>
                      <input
                        id={`startsAt-${tenant.id}`}
                        name="startsAt"
                        type="datetime-local"
                        defaultValue={subscription?.startsAt ? subscription.startsAt.slice(0, 16) : ''}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`endsAt-${tenant.id}`}>Subscription end</label>
                      <input
                        id={`endsAt-${tenant.id}`}
                        name="endsAt"
                        type="datetime-local"
                        defaultValue={subscription?.endsAt ? subscription.endsAt.slice(0, 16) : ''}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`terms-${tenant.id}`}>Payment terms</label>
                      <textarea id={`terms-${tenant.id}`} name="paymentTerms" defaultValue={subscription?.paymentTerms ?? ''} />
                    </div>
                    <div className="field">
                      <label htmlFor={`suspension-reason-${tenant.id}`}>Suspension note</label>
                      <textarea
                        id={`suspension-reason-${tenant.id}`}
                        name="suspensionReason"
                        defaultValue={tenant.suspensionReason ?? ''}
                        placeholder="Only needed when status is suspended"
                      />
                    </div>
                    <label className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        name="autoRenew"
                        defaultChecked={subscription?.autoRenew ?? false}
                        style={{ width: 18, minHeight: 18 }}
                      />
                      Auto-renew this tenant subscription
                    </label>
                    <div className="hero-actions">
                      <button type="submit" className="button">Save subscription</button>
                    </div>
                  </form>

                  <div className="hero-actions">
                    <a href={`/api/v1/reports/export?tenantId=${tenant.id}&format=json`} className="button secondary">
                      Export shop JSON
                    </a>
                    <a href={`/api/v1/reports/export?tenantId=${tenant.id}&format=csv`} className="button secondary">
                      Export shop CSV
                    </a>
                  </div>

                  <form action={clearTenantCustomersAction} className="field-grid">
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <div className="hero-actions">
                      <button type="submit" className="button secondary">Clear customer and finance records</button>
                    </div>
                  </form>
                </div>

                <div className="stack">
                  <div>
                    <h3 style={{ marginTop: 0 }}>Tenant credentials</h3>
                    {credentials.length > 0 ? (
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Username</th>
                            <th>Role</th>
                            <th>Password status</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {credentials.map((user) => (
                            <tr key={user.userId}>
                              <td>
                                <strong>{user.fullName}</strong>
                                <div className="eyebrow">{user.email}</div>
                              </td>
                              <td>{user.username}</td>
                              <td>{user.role}</td>
                              <td>
                                <div>
                                  <strong>{user.passwordUpdatedAt ? 'Password set' : 'Reset required'}</strong>
                                  <div className="eyebrow">
                                    {user.passwordUpdatedAt ? `Updated ${formatDateTime(user.passwordUpdatedAt)}` : 'Not yet stored'}
                                  </div>
                                </div>
                              </td>
                              <td>
                                <div style={{ display: 'grid', gap: 8 }}>
                                  <span>{user.isActive ? 'active' : 'disabled'}</span>
                                  <form action={setUserStatusAction}>
                                    <input type="hidden" name="userId" value={user.userId} />
                                    <input type="hidden" name="redirectTo" value="/super/tenants?success=user-status" />
                                    <input type="hidden" name="nextStatus" value={user.isActive ? 'inactive' : 'active'} />
                                    <button type="submit" className="button secondary" style={{ minHeight: 38 }}>
                                      {user.isActive ? 'Disable' : 'Enable'}
                                    </button>
                                  </form>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="muted">No tenant credentials created yet.</p>
                    )}
                  </div>

                  <form action={setUserPasswordAction} className="field-grid">
                    <div className="field">
                      <label htmlFor={`password-user-${tenant.id}`}>Reset password for</label>
                      <select id={`password-user-${tenant.id}`} name="userId" defaultValue={credentials[0]?.userId}>
                        {credentials.map((user) => (
                          <option key={user.userId} value={user.userId}>
                            {user.fullName} ({user.role})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`password-${tenant.id}`}>New password</label>
                      <input id={`password-${tenant.id}`} name="password" type="password" required />
                    </div>
                    <input type="hidden" name="redirectTo" value="/super/tenants?success=password-updated" />
                    <div className="hero-actions">
                      <button type="submit" className="button secondary" disabled={credentials.length === 0}>
                        Save new password
                      </button>
                    </div>
                  </form>

                  <form action={addUserAction} className="field-grid">
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <div className="field">
                      <label htmlFor={`fullName-${tenant.id}`}>New user full name</label>
                      <input id={`fullName-${tenant.id}`} name="fullName" required />
                    </div>
                    <div className="field">
                      <label htmlFor={`username-${tenant.id}`}>Username</label>
                      <input id={`username-${tenant.id}`} name="username" required />
                    </div>
                    <div className="field">
                      <label htmlFor={`email-${tenant.id}`}>Email</label>
                      <input id={`email-${tenant.id}`} name="email" type="email" required />
                    </div>
                    <div className="field">
                      <label htmlFor={`phone-${tenant.id}`}>Phone</label>
                      <input id={`phone-${tenant.id}`} name="phone" />
                    </div>
                    <div className="field">
                      <label htmlFor={`user-password-${tenant.id}`}>Password</label>
                      <input id={`user-password-${tenant.id}`} name="password" type="password" required />
                    </div>
                    <div className="field">
                      <label htmlFor={`role-${tenant.id}`}>Role</label>
                      <select id={`role-${tenant.id}`} name="role">
                        <option value="staff">Staff</option>
                        <option value="shop_admin">Shop admin</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`commissionType-${tenant.id}`}>Commission type</label>
                      <select id={`commissionType-${tenant.id}`} name="commissionType">
                        <option value="percentage">Percentage</option>
                        <option value="fixed">Fixed</option>
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor={`commissionValue-${tenant.id}`}>Commission value</label>
                      <input id={`commissionValue-${tenant.id}`} name="commissionValue" type="number" min="0" step="1" />
                    </div>
                    <div className="field">
                      <label htmlFor={`commissionNotes-${tenant.id}`}>Payment terms / notes</label>
                      <textarea id={`commissionNotes-${tenant.id}`} name="commissionNotes" />
                    </div>
                    <div className="hero-actions">
                      <button type="submit" className="button">Create tenant user</button>
                    </div>
                  </form>

                </div>
              </div>
            </section>
          );
        })}
      </section>
    </>
  );
}
