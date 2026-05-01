import Link from 'next/link';

import { BusinessPrintHeader } from '@/components/tenant/business-print-header';
import { PrintButton } from '@/components/ui/print-button';
import { formatCurrency } from '@/lib/format';
import { requireSession } from '@/server/auth/demo-session';
import { getMonthlyReport } from '@/server/services/app-data';

type MonthlyReportPageProps = {
  searchParams: Promise<{ month?: string }>;
};

function parseRequestedMonth(value: string | undefined) {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const [, year, month] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1));
}

export default async function MonthlyReportPage({ searchParams }: MonthlyReportPageProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const params = await searchParams;
  const selectedMonth = parseRequestedMonth(params.month) ?? new Date();
  const report = await getMonthlyReport(session.tenant.id, selectedMonth);
  const firstAvailableMonth = report.availableMonths[report.availableMonths.length - 1]?.monthKey;
  const latestAvailableMonth = report.availableMonths[0]?.monthKey;

  return (
    <>
      <BusinessPrintHeader
        tenant={session.tenant}
        title={`${report.monthLabel} monthly report`}
        subtitle="Tenant-isolated performance report covering loyalty, sales, commissions, product usage, expenses, and operational remarks."
      />

      <section className="hero">
        <p className="hero-kicker">Monthly report</p>
        <h1 className="hero-title">{report.monthLabel}</h1>
        <p className="hero-subtitle">
          HAPOS compiles loyal-customer insight, staff ranking, expenses, product costs, and operational remarks for each tenant in isolation.
        </p>
        <div className="month-report-toolbar">
          <form method="get" className="month-report-form">
            <div className="field">
              <label htmlFor="report-month">Choose report month</label>
              <input
                id="report-month"
                name="month"
                type="month"
                defaultValue={report.monthKey}
                min={firstAvailableMonth}
                max={latestAvailableMonth}
              />
            </div>
            <button type="submit" className="button">
              Open month
            </button>
          </form>

          <div className="month-report-nav">
            {report.previousMonthKey ? (
              <Link href={`/app/reports/monthly?month=${report.previousMonthKey}`} className="button secondary">
                Previous month
              </Link>
            ) : null}
            {report.nextMonthKey ? (
              <Link href={`/app/reports/monthly?month=${report.nextMonthKey}`} className="button secondary">
                Next month
              </Link>
            ) : null}
          </div>
        </div>

        <div className="hero-actions">
          <PrintButton />
          <Link href="/api/v1/reports/export?format=json" className="button secondary">
            Export tenant JSON
          </Link>
          <Link href="/api/v1/reports/export?format=csv" className="button secondary">
            Export tenant CSV
          </Link>
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="tile">
          <span className="tile-label">Total revenue</span>
          <div className="tile-value">{formatCurrency(report.totalRevenue)}</div>
        </div>
        <div className="tile">
          <span className="tile-label">Total expenses</span>
          <div className="tile-value">{formatCurrency(report.totalExpenses)}</div>
        </div>
        <div className="tile">
          <span className="tile-label">Total commissions</span>
          <div className="tile-value">{formatCurrency(report.totalCommissions)}</div>
        </div>
        <div className="tile">
          <span className="tile-label">Product costs</span>
          <div className="tile-value">{formatCurrency(report.totalProductCosts)}</div>
        </div>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Loyal customer snapshot</h2>
              <p className="panel-copy">Top customer by visits and by spend for the month.</p>
            </div>
          </div>
          <div className="rows">
            <div className="row">
              <div>
                <strong>Most visits</strong>
                <div className="eyebrow">{report.topCustomerByVisits?.customer.name ?? 'No customer data'}</div>
              </div>
              <div className="eyebrow">
                {report.topCustomerByVisits?.visits ?? 0} visits / {formatCurrency(report.topCustomerByVisits?.spent ?? 0)}
              </div>
            </div>
            <div className="row">
              <div>
                <strong>Highest spend</strong>
                <div className="eyebrow">{report.topCustomerBySpend?.customer.name ?? 'No customer data'}</div>
              </div>
              <div className="eyebrow">
                {formatCurrency(report.topCustomerBySpend?.spent ?? 0)} / {report.topCustomerBySpend?.visits ?? 0} visits
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Most used products</h2>
              <p className="panel-copy">Pulled from product usage recorded against service jobs.</p>
            </div>
          </div>
          <div className="rows">
            {report.topProducts.map((product) => (
              <div key={product.productName} className="row">
                <div>
                  <strong>{product.productName}</strong>
                  <div className="eyebrow">{product.usageCount} units used</div>
                </div>
                <strong>{formatCurrency(product.totalCost)}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Employee ranking</h2>
            <p className="panel-copy">Shows who sold the most, earned the most commission, and handled the most clients.</p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Clients</th>
              <th>Services</th>
              <th>Sales</th>
              <th>Commission</th>
            </tr>
          </thead>
          <tbody>
            {report.staffRanking.map((row) => (
              <tr key={row.staffId}>
                <td>{row.staffName}</td>
                <td>{row.clientCount}</td>
                <td>{row.totalServices}</td>
                <td>{formatCurrency(row.totalRevenue)}</td>
                <td>{formatCurrency(row.totalCommission)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid-two">
        <div className="panel">
          <h2>Areas of improvement</h2>
          <div className="rows">
            {report.improvements.map((item) => (
              <div key={item} className="row">
                <div className="eyebrow">{item}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>Biggest headaches</h2>
          <div className="rows">
            {report.headaches.map((item) => (
              <div key={item} className="row">
                <div className="eyebrow">{item}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Remarks</h2>
        <div className="rows">
          {report.remarks.map((item) => (
            <div key={item} className="row">
              <div className="eyebrow">{item}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
