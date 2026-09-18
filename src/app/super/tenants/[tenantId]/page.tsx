import { redirect } from 'next/navigation';

import {
  addUserAction,
  clearTenantCustomersAction,
  setUserPasswordAction,
  setUserStatusAction,
  suspendTenantAction,
  updateTenantBrandingAction,
  updateTenantSubscriptionAction,
} from '@/server/actions/hapos';
import { BookingQrPanel } from '@/components/tenant/booking-qr-panel';
import { BusinessAvatar } from '@/components/tenant/business-avatar';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { getSubscriptionDisplayName } from '@/lib/plans';
import { buildCustomerBookingUrl, listSubscriptionPackages, listSubscriptions, listTenants } from '@/server/services/app-data';
import { getPlatformOverview, listCredentialRecordsForTenant } from '@/server/services/admin-tools';

export const dynamic = 'force-dynamic';

type TenantWorkspacePageProps = {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
};

function getFeedbackMessage(params: { success?: string; error?: string }) {
  if (params.error === 'user-exists') return 'That username or email already exists for this shop.';
  if (params.error === 'password-required') return 'Enter a password before saving.';
  if (params.error === 'logo-upload') return 'Upload a valid image file for the business logo.';
  if (params.error === 'invalid-employee-number') return 'Enter a valid, unique employee number for that user.';
  if (params.success === 'user-added') return 'Tenant login created.';
  if (params.success === 'password-updated') return 'Password updated.';
  if (params.success === 'user-status') return 'User access updated.';
  if (params.success === 'branding-updated') return 'Business profile updated for receipts and reports.';
  if (params.success === 'subscription-updated') return 'Tenant subscription updated.';
  if (params.success === 'suspended') return 'Tenant suspended.';
  if (params.success === 'cleared') return 'Customer, service, SMS, expense, and commission records cleared for that shop.';
  return 'Tenant update saved.';
}

export default async function TenantWorkspacePage({ params, searchParams }: TenantWorkspacePageProps) {
  const { tenantId } = await params;
  const query = await searchParams;
  const [tenants, subscriptions, subscriptionPackages, platformOverview] = await Promise.all([
    listTenants(),
    listSubscriptions(),
    listSubscriptionPackages(),
    getPlatformOverview(),
  ]);
  const tenant = tenants.find((item) => item.id === tenantId) ?? null;
  if (!tenant) {
    redirect('/super/tenants');
  }

  const subscription = subscriptions.find((item) => item.tenantId === tenant.id);
  const tenantOverview = platformOverview.tenantRows.find((row) => row.tenantId === tenant.id);
  const credentials = await listCredentialRecordsForTenant(tenant.id);
  const bookingUrl = buildCustomerBookingUrl(tenant.slug);
  const workspaceBase = `/super/tenants/${tenant.id}`;

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">
          <a href="/super/tenants">← Tenants</a>
        </p>
        <h1 className="hero-title">{tenant.name}</h1>
        <p className="hero-subtitle">
          Owner: {tenant.ownerName ?? 'Not set'} / Business slug: {tenant.slug} / Licence status:{' '}
          {subscription?.status ?? 'unknown'}
        </p>
      </section>

      {query.success || query.error ? (
        <section className="panel">
          <span className="pill">{getFeedbackMessage(query)}</span>
        </section>
      ) : null}

      <section className="panel">
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
              <input type="hidden" name="redirectTo" value={workspaceBase} />
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
                  <label htmlFor="tenant-name">Business name</label>
                  <input id="tenant-name" name="name" defaultValue={tenant.name} required />
                </div>
                <div className="field">
                  <label htmlFor="tenant-owner">Owner name</label>
                  <input id="tenant-owner" name="ownerName" defaultValue={tenant.ownerName ?? ''} />
                </div>
                <div className="field">
                  <label htmlFor="tenant-store">Store number</label>
                  <input id="tenant-store" name="storeNumber" defaultValue={tenant.storeNumber ?? ''} />
                </div>
                <div className="field">
                  <label htmlFor="tenant-logo">Upload new logo</label>
                  <input id="tenant-logo" name="logoFile" type="file" accept="image/*" />
                </div>
                <div className="field">
                  <label htmlFor="tenant-motto">Motto</label>
                  <textarea id="tenant-motto" name="motto" defaultValue={tenant.motto ?? ''} />
                </div>
                <div className="field">
                  <label htmlFor="tenant-address">Address</label>
                  <textarea id="tenant-address" name="address" defaultValue={tenant.address ?? ''} />
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

            <BookingQrPanel
              tenantId={tenant.id}
              tenantName={tenant.name}
              bookingUrl={bookingUrl}
              heading="Customer booking QR"
              copy="Only admins can generate and download this code. Post it in the workplace so customers can scan directly into the booking page."
            />

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
              <input type="hidden" name="redirectTo" value={workspaceBase} />
              <div className="field">
                <label htmlFor="reason">Suspend reason</label>
                <textarea id="reason" name="reason" defaultValue={tenant.suspensionReason ?? ''} />
              </div>
              <div className="hero-actions">
                <button type="submit" className="button secondary">Suspend tenant</button>
              </div>
            </form>

            <form action={updateTenantSubscriptionAction} className="field-grid">
              <input type="hidden" name="tenantId" value={tenant.id} />
              <input type="hidden" name="redirectTo" value={workspaceBase} />
              <div className="field">
                <label htmlFor="tenant-package">Assigned package</label>
                <select
                  id="tenant-package"
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
                <label htmlFor="tenant-status">Subscription status</label>
                <select id="tenant-status" name="status" defaultValue={subscription?.status ?? 'active'}>
                  <option value="trialing">Trialing</option>
                  <option value="active">Active</option>
                  <option value="past_due">Past due</option>
                  <option value="expired">Expired</option>
                  <option value="suspended">Suspended</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="tenant-amount">Billed amount</label>
                <input
                  id="tenant-amount"
                  name="amount"
                  type="number"
                  min="0"
                  step="1"
                  defaultValue={subscription?.amount ?? 0}
                />
              </div>
              <div className="field">
                <label htmlFor="tenant-currency">Currency</label>
                <input id="tenant-currency" name="currencyCode" defaultValue={subscription?.currencyCode ?? tenant.currencyCode} />
              </div>
              <div className="field">
                <label htmlFor="startsAt">Subscription start</label>
                <input
                  id="startsAt"
                  name="startsAt"
                  type="datetime-local"
                  defaultValue={subscription?.startsAt ? subscription.startsAt.slice(0, 16) : ''}
                />
              </div>
              <div className="field">
                <label htmlFor="endsAt">Subscription end</label>
                <input
                  id="endsAt"
                  name="endsAt"
                  type="datetime-local"
                  defaultValue={subscription?.endsAt ? subscription.endsAt.slice(0, 16) : ''}
                />
              </div>
              <div className="field">
                <label htmlFor="terms">Payment terms</label>
                <textarea id="terms" name="paymentTerms" defaultValue={subscription?.paymentTerms ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="suspension-reason">Suspension note</label>
                <textarea
                  id="suspension-reason"
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
              <input type="hidden" name="redirectTo" value={workspaceBase} />
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
                              <input type="hidden" name="redirectTo" value={`${workspaceBase}?success=user-status`} />
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
                <label htmlFor="password-user">Reset password for</label>
                <select id="password-user" name="userId" defaultValue={credentials[0]?.userId}>
                  {credentials.map((user) => (
                    <option key={user.userId} value={user.userId}>
                      {user.fullName} ({user.role})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="password">New password</label>
                <input id="password" name="password" type="password" required />
              </div>
              <input type="hidden" name="redirectTo" value={`${workspaceBase}?success=password-updated`} />
              <div className="hero-actions">
                <button type="submit" className="button secondary" disabled={credentials.length === 0}>
                  Save new password
                </button>
              </div>
            </form>

            <form action={addUserAction} className="field-grid">
              <input type="hidden" name="tenantId" value={tenant.id} />
              <input type="hidden" name="redirectTo" value={workspaceBase} />
              <div className="field">
                <label htmlFor="fullName">New user full name</label>
                <input id="fullName" name="fullName" required />
              </div>
              <div className="field">
                <label htmlFor="username">Username</label>
                <input id="username" name="username" required />
              </div>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" name="email" type="email" required />
              </div>
              <div className="field">
                <label htmlFor="phone">Phone</label>
                <input id="phone" name="phone" />
              </div>
              <div className="field">
                <label htmlFor="user-password">Password</label>
                <input id="user-password" name="password" type="password" required />
              </div>
              <div className="field">
                <label htmlFor="role">Role</label>
                <select id="role" name="role">
                  <option value="staff">Staff</option>
                  <option value="shop_admin">Shop admin</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="commissionType">Commission type</label>
                <select id="commissionType" name="commissionType">
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="commissionValue">Commission value</label>
                <input id="commissionValue" name="commissionValue" type="number" min="0" step="1" />
              </div>
              <div className="field">
                <label htmlFor="commissionNotes">Payment terms / notes</label>
                <textarea id="commissionNotes" name="commissionNotes" />
              </div>
              <div className="hero-actions">
                <button type="submit" className="button">Create tenant user</button>
              </div>
            </form>

          </div>
        </div>
      </section>
    </>
  );
}
