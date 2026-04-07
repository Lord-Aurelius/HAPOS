import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BusinessPrintHeader } from '@/components/tenant/business-print-header';
import { PrintButton } from '@/components/ui/print-button';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { requireSession } from '@/server/auth/demo-session';
import { listAllCustomers, listServiceRecords } from '@/server/services/app-data';

type ReceiptPageProps = {
  params: Promise<{ recordId: string }>;
};

export default async function ReceiptPage({ params }: ReceiptPageProps) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return null;
  }
  const tenant = session.tenant;

  const { recordId } = await params;
  const [records, customers] = await Promise.all([
    listServiceRecords(tenant.id),
    listAllCustomers(tenant.id),
  ]);

  const record = records.find((item) => item.id === recordId);
  if (!record) {
    notFound();
  }

  if (session.user.role === 'staff' && record.staffId !== session.user.id) {
    notFound();
  }

  const customer = customers.find((item) => item.id === record.customerId) ?? null;

  return (
    <>
      <BusinessPrintHeader
        tenant={tenant}
        title="Service receipt"
        subtitle="Professional receipt generated from the tenant ledger. Print this page or save it as a PDF for your records."
      />

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Receipt summary</h2>
            <p className="panel-copy">This receipt uses the shop identity configured by the HAPOS super admin portal.</p>
          </div>
          <div className="hero-actions" style={{ marginTop: 0 }}>
            <PrintButton />
            <Link href={`/app/sales?recordId=${record.id}`} className="button secondary">
              Back to sales ledger
            </Link>
          </div>
        </div>

        <div className="receipt-grid">
          <div className="receipt-card">
            <span className="tile-label">Customer</span>
            <strong>{record.customerName}</strong>
            <div className="eyebrow">{customer?.phoneE164 ?? 'Phone not available'}</div>
          </div>
          <div className="receipt-card">
            <span className="tile-label">Service</span>
            <strong>{record.serviceName}</strong>
            <div className="eyebrow">{record.isCustomService ? 'Custom service' : 'Price-list service'}</div>
          </div>
          <div className="receipt-card">
            <span className="tile-label">Staff member</span>
            <strong>{record.staffName}</strong>
            <div className="eyebrow">{formatDateTime(record.performedAt)}</div>
          </div>
          <div className="receipt-card">
            <span className="tile-label">Amount paid</span>
            <strong>{formatCurrency(record.price, tenant.currencyCode)}</strong>
            <div className="eyebrow">Commission: {formatCurrency(record.commission, tenant.currencyCode)}</div>
          </div>
        </div>

        <div className="grid-two" style={{ marginTop: 20 }}>
          <div className="panel" style={{ padding: 20 }}>
            <h3 style={{ marginTop: 0 }}>Notes and usage</h3>
            <div className="stack">
              <div className="list-row">
                <div>
                  <strong>Description</strong>
                  <div className="eyebrow">{record.description || 'No extra notes recorded.'}</div>
                </div>
              </div>
              <div className="list-row">
                <div>
                  <strong>Products used</strong>
                  <div className="eyebrow">
                    {record.productUsages && record.productUsages.length > 0
                      ? record.productUsages
                          .map((usage) => `${usage.productName} x${usage.quantity} (${formatCurrency(usage.totalCost, tenant.currencyCode)})`)
                          .join(', ')
                      : 'No product usage recorded for this service.'}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel" style={{ padding: 20 }}>
            <h3 style={{ marginTop: 0 }}>Audit trail</h3>
            <div className="stack">
              <div className="list-row">
                <div>
                  <strong>Original record time</strong>
                  <div className="eyebrow">{formatDateTime(record.performedAt)}</div>
                </div>
              </div>
              <div className="list-row">
                <div>
                  <strong>Correction status</strong>
                  <div className="eyebrow">
                    {record.correctedAt
                      ? `Corrected on ${formatDateTime(record.correctedAt)} by ${record.correctedByName ?? 'Admin'}`
                      : 'No correction has been made on this receipt.'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
