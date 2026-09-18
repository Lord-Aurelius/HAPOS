import { formatCurrency } from '@/lib/format';
import { getSubscriptionDisplayName } from '@/lib/plans';
import { listSubscriptionPackages, listSubscriptions, listTenants } from '@/server/services/app-data';
import { getPlatformOverview } from '@/server/services/admin-tools';

export default async function SuperTenantsPage() {
  const [tenants, subscriptions, subscriptionPackages, platformOverview] = await Promise.all([
    listTenants(),
    listSubscriptions(),
    listSubscriptionPackages(),
    getPlatformOverview(),
  ]);
  const packageById = new Map(subscriptionPackages.map((item) => [item.id, item]));

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Super admin</p>
        <h1 className="hero-title">Tenants.</h1>
        <p className="hero-subtitle">Every shop on the platform. Select a tenant to open its management workspace.</p>
        <div className="hero-actions">
          <a href="/super/onboard" className="button secondary">
            Onboard new shop
          </a>
        </div>
      </section>

      <section className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Shop</th>
              <th>Package</th>
              <th>Status</th>
              <th>Customers</th>
              <th>Employees</th>
              <th>All-time revenue</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => {
              const subscription = subscriptions.find((item) => item.tenantId === tenant.id);
              const overview = platformOverview.tenantRows.find((row) => row.tenantId === tenant.id);
              const assignedPackage = subscription?.packageId ? packageById.get(subscription.packageId) : null;
              return (
                <tr key={tenant.id}>
                  <td>
                    <strong>{tenant.name}</strong>
                    <div className="eyebrow">
                      Owner: {tenant.ownerName ?? 'Not set'} / Slug: {tenant.slug}
                    </div>
                  </td>
                  <td>{assignedPackage ? `${assignedPackage.name} / ${formatCurrency(assignedPackage.amount)}` : getSubscriptionDisplayName(subscription)}</td>
                  <td>
                    {tenant.status}
                    <div className="eyebrow">Licence: {subscription?.status ?? 'unknown'}</div>
                  </td>
                  <td>{overview?.customerCount ?? 0}</td>
                  <td>{overview?.employeeCount ?? 0}</td>
                  <td>{formatCurrency(overview?.allTimeRevenue ?? 0)}</td>
                  <td>
                    <a className="button secondary" href={`/super/tenants/${tenant.id}`}>
                      Open
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
