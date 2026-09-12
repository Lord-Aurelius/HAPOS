import Link from 'next/link';
import { notFound } from 'next/navigation';

import { BusinessPrintHeader } from '@/components/tenant/business-print-header';
import { PrintButton } from '@/components/ui/print-button';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { requireSession } from '@/server/auth/demo-session';
import { getCommerceRepository } from '@/server/commerce/repository-select';
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

  // Phase 4: show the linked engine payment (if any) — never a fake success.
  let paymentPanel: { method: string; status: string; reference: string | null; customerPhone: string | null; saleTotal: number | null } | null = null;
  const linkedSaleId = (record as unknown as { commerceSaleId?: string | null }).commerceSaleId ?? null;
  if (linkedSaleId) {
    try {
      const repo = getCommerceRepository();
      const sale = await repo.getSaleView(tenant.id, linkedSaleId);
      if (sale) {
        const payments = await repo.listPayments(tenant.id, { orderId: sale.orderId });
        const latest = payments[0] ?? null;
        paymentPanel = {
          method: sale.paymentMethod ?? 'CASH',
          status: latest?.status ?? (sale.status === 'COMPLETED' ? 'paid via engine' : 'no payment record'),
          reference: latest?.providerReference ?? null,
          customerPhone: latest?.customerPhone ?? null,
          saleTotal: sale.total,
        };
      }
    } catch {
      // Receipt never fails because payment lookup failed.
    }
  }

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
          {paymentPanel ? (
            <div className="receipt-card">
              <span className="tile-label">Payment</span>
              <strong>
                {paymentPanel.method} · {paymentPanel.status}
              </strong>
              <div className="eyebrow">
                {paymentPanel.reference ? `Ref ${paymentPanel.reference}` : 'No provider reference'}
                {paymentPanel.customerPhone ? ` · ${paymentPanel.customerPhone}` : ''}
              </div>
              {paymentPanel.saleTotal !== null && paymentPanel.saleTotal !== record.price ? (
                <div className="eyebrow">Engine total {formatCurrency(paymentPanel.saleTotal, tenant.currencyCode)} (may differ for mixed carts)</div>
              ) : null}
              {paymentPanel.status === 'PENDING' ? (
                <div className="eyebrow">Payment pending — not yet confirmed by the provider.</div>
              ) : null}
              {paymentPanel.status === 'FAILED' || paymentPanel.status === 'EXPIRED' ? (
                <div className="eyebrow">Payment did not succeed — this receipt reflects the service ledger only.</div>
              ) : null}
            </div>
          ) : null}
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
