import { formatCurrency } from '@/lib/format';
import { requireSession } from '@/server/auth/demo-session';
import { listCommerceOrders, listCommerceSales } from '@/server/commerce/order-service';

type SellerPageProps = {
  searchParams: Promise<{ orderId?: string; saleId?: string }>;
};

/**
 * Seller portal (Phase 3). Authenticated sellers see ONLY their own commerce
 * activity: seller identity always comes from the session, never from request
 * parameters. No inventory, catalog-admin, staff, or settings surfaces here.
 */
export default async function SellerPortalPage({ searchParams }: SellerPageProps) {
  const session = await requireSession(['shop_admin', 'staff']);
  if (!session.tenant) {
    return null;
  }
  const tenant = session.tenant;
  const commerce = { tenantId: tenant.id, userId: session.user.id, userRole: session.user.role } as const;

  const params = await searchParams;
  const [orders, sales] = await Promise.all([
    listCommerceOrders(commerce, { ownOnly: true }),
    listCommerceSales(commerce, { ownOnly: true }),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const todaysSales = sales.filter((sale) => sale.createdAt.slice(0, 10) === today && sale.status === 'COMPLETED');
  const todaysTotal = todaysSales.reduce((sum, sale) => sum + sale.total, 0);
  const pending = orders.filter((order) => order.status === 'SUBMITTED' || order.status === 'PENDING_REVIEW');
  const selectedOrder = params.orderId ? orders.find((order) => order.id === params.orderId) ?? null : null;
  const selectedSale = params.saleId ? sales.find((sale) => sale.id === params.saleId) ?? null : null;

  const statusGroups: { label: string; items: typeof orders }[] = [
    { label: 'Pending review', items: pending },
    { label: 'Approved', items: orders.filter((order) => order.status === 'APPROVED') },
    { label: 'Completed', items: orders.filter((order) => order.status === 'COMPLETED') },
    {
      label: 'Cancelled / rejected',
      items: orders.filter((order) => order.status === 'CANCELLED' || order.status === 'REJECTED'),
    },
  ];

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Seller portal</p>
        <h1 className="hero-title">Your sales, nothing else.</h1>
        <p className="hero-subtitle">
          Today: {todaysSales.length} sale(s) · {formatCurrency(todaysTotal, tenant.currencyCode)}. Completed
          sales are read-only — ask an admin about corrections or voids.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Recent transactions ({sales.length})</h2>
            <p className="panel-copy">Every sale you recorded, including QR-originated ones, with prices and status.</p>
          </div>
        </div>
        <div className="stack">
          {sales.slice(0, 15).map((sale) => (
            <div key={sale.id} className="list-row">
              <div>
                <strong>{sale.customerName ?? 'Walk-in'}</strong>
                <div className="eyebrow">
                  {sale.status} · {sale.items.length} line(s) · {sale.createdAt.slice(0, 16).replace('T', ' ')}
                  {sale.source === 'SELLER_QR' ? ' · via seller QR' : ''}
                </div>
                <div className="eyebrow">
                  {sale.items.map((item) => `${item.itemName} × ${item.quantity}`).join(' · ')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <strong>{formatCurrency(sale.total, tenant.currencyCode)}</strong>
                <a className="button secondary" href={`/app/seller?saleId=${sale.id}`}>
                  View
                </a>
              </div>
            </div>
          ))}
          {sales.length === 0 ? <div className="eyebrow">No sales recorded yet.</div> : null}
        </div>
      </section>

      {statusGroups.map((group) => (
        <section key={group.label} className="panel">
          <div className="panel-header">
            <div>
              <h2>
                {group.label} ({group.items.length})
              </h2>
            </div>
          </div>
          <div className="stack">
            {group.items.slice(0, 10).map((order) => (
              <div key={order.id} className="list-row">
                <div>
                  <strong>{order.customerName ?? 'Walk-in'}</strong>
                  <div className="eyebrow">
                    {order.status} · {order.items.map((item) => `${item.itemName} × ${item.quantity}`).join(' · ')}
                  </div>
                  <div className="eyebrow">
                    {order.items.map(
                      (item) =>
                        `catalog ${formatCurrency(item.catalogUnitPrice, tenant.currencyCode)} / charged ${formatCurrency(item.actualUnitPrice, tenant.currencyCode)}`,
                    ).join(' · ')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <strong>{formatCurrency(order.total, tenant.currencyCode)}</strong>
                  <a className="button secondary" href={`/app/seller?orderId=${order.id}`}>
                    View
                  </a>
                </div>
              </div>
            ))}
            {group.items.length === 0 ? <div className="eyebrow">Nothing here.</div> : null}
          </div>
        </section>
      ))}

      {selectedOrder ? (
        <section className="panel">
          <h2>Order detail (read-only)</h2>
          <p className="panel-copy">
            {selectedOrder.id} · {selectedOrder.status} · total {formatCurrency(selectedOrder.total, tenant.currencyCode)}
          </p>
          <div className="stack">
            {selectedOrder.items.map((item) => (
              <div key={item.id} className="list-row">
                <div>
                  <strong>
                    [{item.itemType}] {item.itemName} × {item.quantity}
                  </strong>
                  <div className="eyebrow">
                    catalog {formatCurrency(item.catalogUnitPrice, tenant.currencyCode)} · charged{' '}
                    {formatCurrency(item.actualUnitPrice, tenant.currencyCode)}
                    {item.overrideReason ? ` · ${item.overrideReason}` : ''}
                  </div>
                </div>
                <strong>{formatCurrency(item.lineTotal, tenant.currencyCode)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {selectedSale ? (
        <section className="panel">
          <h2>Sale detail (read-only)</h2>
          <p className="panel-copy">
            {selectedSale.id} · {selectedSale.status} · total {formatCurrency(selectedSale.total, tenant.currencyCode)}
          </p>
          <div className="stack">
            {selectedSale.items.map((item) => (
              <div key={item.id} className="list-row">
                <div>
                  <strong>
                    [{item.itemType}] {item.itemName} × {item.quantity}
                  </strong>
                  <div className="eyebrow">
                    catalog {formatCurrency(item.catalogUnitPrice, tenant.currencyCode)} · charged{' '}
                    {formatCurrency(item.actualUnitPrice, tenant.currencyCode)}
                  </div>
                </div>
                <strong>{formatCurrency(item.lineTotal, tenant.currencyCode)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
