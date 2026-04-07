import Link from 'next/link';

import { HaposLogo } from '@/components/branding/hapos-logo';
import { formatCurrency, formatDateTime } from '@/lib/format';
import {
  getMonthlyReport,
  listCustomers,
  listServiceRecords,
  listServices,
  listTenants,
} from '@/server/services/app-data';

export const dynamic = 'force-dynamic';

export default async function PreviewPage() {
  const tenant = (await listTenants())[0];

  if (!tenant) {
    return null;
  }

  const [services, customers, records, report] = await Promise.all([
    listServices(tenant.id),
    listCustomers(tenant.id),
    listServiceRecords(tenant.id),
    getMonthlyReport(tenant.id),
  ]);

  return (
    <main className="workspace">
      <div className="workspace-inner">
        <section className="hero">
          <HaposLogo />
          <p className="hero-kicker">Read-only preview</p>
          <h1 className="hero-title">{tenant.name}</h1>
          <p className="hero-subtitle">
            This page is a safe read-only snapshot of the current tenant data. Use the login page to work through the staff, admin, and super-admin flows.
          </p>
          <div className="hero-actions">
            <Link href="/login" className="button">
              Open the real app
            </Link>
            <Link href="/" className="button secondary">
              Back home
            </Link>
          </div>
        </section>

        <section className="dashboard-grid">
          <div className="tile">
            <span className="tile-label">Month revenue</span>
            <div className="tile-value">{formatCurrency(report.totalRevenue)}</div>
          </div>
          <div className="tile">
            <span className="tile-label">Month expenses</span>
            <div className="tile-value">{formatCurrency(report.totalExpenses)}</div>
          </div>
          <div className="tile">
            <span className="tile-label">Commissions</span>
            <div className="tile-value">{formatCurrency(report.totalCommissions)}</div>
          </div>
          <div className="tile">
            <span className="tile-label">Active customers</span>
            <div className="tile-value">{customers.length}</div>
          </div>
        </section>

        <section className="grid-two">
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Published price list</h2>
                <p className="panel-copy">Staff can see the official service menu while still recording off-menu work in the live app.</p>
              </div>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Price</th>
                  <th>Commission</th>
                </tr>
              </thead>
              <tbody>
                {services.map((service) => (
                  <tr key={service.id}>
                    <td>{service.name}</td>
                    <td>{formatCurrency(service.price)}</td>
                    <td>
                      {service.commissionType === 'fixed'
                        ? formatCurrency(service.commissionValue)
                        : `${service.commissionValue}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Role split</h2>
                <p className="panel-copy">Admins manage people, pricing, expenses, exports, and recovery. Staff focus on service entry and their own earnings.</p>
              </div>
            </div>
            <div className="stack">
              <div className="list-row">
                <div>
                  <strong>Shop admin</strong>
                  <div className="eyebrow">Controls credentials, commissions, expenses, history, and exports for one business.</div>
                </div>
              </div>
              <div className="list-row">
                <div>
                  <strong>Staff</strong>
                  <div className="eyebrow">Records services, sees the price list, and tracks daily and monthly earnings.</div>
                </div>
              </div>
              <div className="list-row">
                <div>
                  <strong>Super admin</strong>
                  <div className="eyebrow">Sees all tenants, renewals, exports, and portfolio analytics across shops.</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid-two">
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Recent services</h2>
                <p className="panel-copy">Shows the speed-focused service recording flow the live app supports.</p>
              </div>
            </div>
            <div className="stack">
              {records.slice(0, 6).map((record) => (
                <div className="list-row" key={record.id}>
                  <div>
                    <strong>{record.customerName}</strong>
                    <div className="eyebrow">
                      {record.serviceName} with {record.staffName}
                    </div>
                  </div>
                  <div>
                    <strong>{formatCurrency(record.price)}</strong>
                    <div className="eyebrow">{formatDateTime(record.performedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Monthly ranking</h2>
                <p className="panel-copy">Each tenant gets isolated monthly staff ranking and loyalty reporting.</p>
              </div>
            </div>
            <div className="stack">
              {report.staffRanking.map((row) => (
                <div className="list-row" key={row.staffId}>
                  <div>
                    <strong>{row.staffName}</strong>
                    <div className="eyebrow">{row.clientCount} clients / {row.totalServices} services</div>
                  </div>
                  <div>
                    <strong>{formatCurrency(row.totalRevenue)}</strong>
                    <div className="eyebrow">{formatCurrency(row.totalCommission)} commission</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
