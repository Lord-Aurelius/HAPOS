import { formatCurrency, formatDate } from '@/lib/format';
import { getPlatformOverview } from '@/server/services/admin-tools';

export default async function SuperDashboardPage() {
  const platformOverview = await getPlatformOverview();

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Super admin</p>
        <h1 className="hero-title">HAPOS command center.</h1>
        <p className="hero-subtitle">
          Platform overview. Manage shops from Tenants, onboard from Onboard, packages from Packages, and API
          connections from Connections.
        </p>
        <div className="hero-actions">
          <a href="/super/tenants" className="button secondary">
            Open tenants
          </a>
          <a href="/super/marketplace" className="button secondary">
            Open marketplace approvals
          </a>
        </div>
      </section>

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
            <h2>Portfolio view</h2>
            <p className="panel-copy">
              Compare tenant performance across revenue, customer base, and product usage so you can price, support, and expand HAPOS strategically.
            </p>
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
                  <strong>
                    <a href={`/super/tenants/${tenant.tenantId}`}>{tenant.tenantName}</a>
                  </strong>
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
    </>
  );
}
