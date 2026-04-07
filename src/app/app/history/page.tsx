import Link from 'next/link';

import { formatCurrency, formatDateTime } from '@/lib/format';
import { requireSession } from '@/server/auth/demo-session';
import { listCustomers, listExpenses, listServiceRecords } from '@/server/services/app-data';

export default async function HistoryPage() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const [customers, expenses, records] = await Promise.all([
    listCustomers(session.tenant.id),
    listExpenses(session.tenant.id),
    listServiceRecords(session.tenant.id),
  ]);

  const totalRevenue = records.reduce((sum, record) => sum + record.price, 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const firstRecordAt = records[records.length - 1]?.performedAt ?? null;

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Archive and export</p>
        <h1 className="hero-title">Keep records for years, then pull them on demand.</h1>
        <p className="hero-subtitle">
          HAPOS keeps the tenant archive available for admin review and export whenever you need historical sales, customer, or expense data.
        </p>
        <div className="hero-actions">
          <Link href="/api/v1/reports/export?format=json" className="button">
            Export JSON
          </Link>
          <Link href="/api/v1/reports/export?format=csv" className="button secondary">
            Export CSV
          </Link>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="tile">
          <span className="tile-label">All-time revenue</span>
          <div className="tile-value">{formatCurrency(totalRevenue)}</div>
        </div>
        <div className="tile">
          <span className="tile-label">All-time expenses</span>
          <div className="tile-value">{formatCurrency(totalExpenses)}</div>
        </div>
        <div className="tile">
          <span className="tile-label">Archived customers</span>
          <div className="tile-value">{customers.filter((customer) => customer.archivedAt).length}</div>
        </div>
        <div className="tile">
          <span className="tile-label">First recorded job</span>
          <div className="tile-value" style={{ fontSize: '1.15rem' }}>
            {firstRecordAt ? formatDateTime(firstRecordAt) : 'No records'}
          </div>
        </div>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Service archive</h2>
              <p className="panel-copy">The latest entries are shown here, while export downloads include the full ledger.</p>
            </div>
          </div>
          <div className="stack">
            {records.slice(0, 12).map((record) => (
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
              <h2>Expense archive</h2>
              <p className="panel-copy">Expenses remain exportable with the same long-term retention as service records.</p>
            </div>
          </div>
          <div className="stack">
            {expenses.slice(0, 12).map((expense) => (
              <div className="list-row" key={expense.id}>
                <div>
                  <strong>{expense.category}</strong>
                  <div className="eyebrow">{expense.description}</div>
                </div>
                <div>
                  <strong>{formatCurrency(expense.amount)}</strong>
                  <div className="eyebrow">{expense.expenseDate}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
