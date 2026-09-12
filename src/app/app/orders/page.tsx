import { randomUUID } from 'node:crypto';

import { formatCurrency } from '@/lib/format';
import { QuantityStepper } from '@/components/cart/quantity-stepper';
import { requireSession } from '@/server/auth/demo-session';
import {
  approveCommerceOrderAction,
  cancelCommerceOrderAction,
  createCommerceOrderAction,
  rejectCommerceOrderAction,
  voidCommerceSaleAction,
} from '@/server/actions/commerce';
import {
  expireOverduePaymentsAction,
  recoverPaidOrderAction,
  retryOrderPaymentAction,
} from '@/server/actions/payments';
import {
  getCommerceOrder,
  getCommerceSale,
  getOrderPayments,
  getTenantPolicy,
  listCommerceOrders,
  listCommerceSales,
} from '@/server/commerce/order-service';
import { listCustomers, listProducts, listServices } from '@/server/services/app-data';

type OrdersPageProps = {
  searchParams: Promise<{ orderId?: string; saleId?: string; success?: string; error?: string }>;
};

function getMessage(params: { success?: string; error?: string }) {
  if (params.success === 'order-created') {
    return 'Order created and routed by merchant policy.';
  }
  if (params.success === 'order-duplicate') {
    return 'That submission was already recorded — showing the original transaction.';
  }
  if (params.success === 'order-approved') {
    return 'Order approved. Sale finalized and stock posted atomically.';
  }
  if (params.success === 'order-rejected') {
    return 'Order rejected and closed.';
  }
  if (params.success === 'order-cancelled') {
    return 'Order cancelled before completion.';
  }
  if (params.success === 'sale-voided') {
    return 'Sale voided. Stock effects were reversed with audited movements.';
  }
  if (!params.error) {
    return null;
  }
  const messages: Record<string, string> = {
    'empty-order': 'Add at least one product or service line.',
    'unknown-item': 'One of the referenced records was not found for this shop.',
    'cross-tenant-item': 'One of the selected items belongs to another shop.',
    'inactive-item': 'One of the selected items is not currently sellable.',
    'needs-pricing': 'A selected product has no selling price yet. Set one on the Products page first.',
    'invalid-price': 'Prices must be valid amounts of zero or more.',
    'invalid-quantity': 'Quantities must be positive whole numbers.',
    'total-mismatch': 'The submitted total did not match the server computation.',
    'invalid-transition': 'That status change is not allowed from the current state.',
    'override-reason-required': 'Price changes need a reason.',
    'not-permitted': 'Your role cannot perform that step. An admin is required.',
    'insufficient-stock': 'Insufficient stock — the sale was blocked and nothing was deducted.',
    'already-approved': 'That order was already approved.',
    'already-voided': 'That sale was already voided.',
    'zero-quantity': 'Movement quantities must be non-zero whole numbers.',
    'invalid-sign': 'Invalid movement direction for its type.',
    'negative-stock': 'That change would drive stock negative and was rejected.',
    'no-change': 'No stock change was needed.',
    'invalid-idempotency-key': 'That submission carried an invalid retry key. Refresh and submit once.',
    'order-failed': 'That commerce step could not be completed.',
  };
  return messages[params.error] ?? `That commerce step failed (${params.error}).`;
}

export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return null;
  }
  const tenant = session.tenant;
  const commerce = { tenantId: tenant.id, userId: session.user.id, userRole: session.user.role } as const;

  const params = await searchParams;
  const [orders, sales, customers, products, services, policy] = await Promise.all([
    listCommerceOrders(commerce),
    listCommerceSales(commerce),
    listCustomers(tenant.id),
    listProducts(tenant.id),
    listServices(tenant.id),
    getTenantPolicy(tenant.id),
  ]);
  const selectedOrder = params.orderId ? await getCommerceOrder(commerce, params.orderId) : null;
  const selectedSale = params.saleId ? await getCommerceSale(commerce, params.saleId) : null;
  const selectedOrderPayments = selectedOrder ? await getOrderPayments(commerce, selectedOrder.id) : [];
  const selectedSalePayments = selectedSale ? await getOrderPayments(commerce, selectedSale.orderId) : [];
  const feedback = getMessage(params);
  const actionable = orders.filter(
    (order) => order.status === 'SUBMITTED' || order.status === 'PENDING_REVIEW',
  );
  const idempotencyKey = randomUUID();
  const isAdmin = session.user.role !== 'staff';

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Commerce orders</p>
        <h1 className="hero-title">One order model for products and services.</h1>
        <p className="hero-subtitle">
          {policy.orderReviewRequired
            ? 'Customer bookings wait for admin review. Staff sales complete immediately unless discounted.'
            : 'Review is relaxed: bookings approve on submit.'}{' '}
          Approvals finalize the sale and post stock in one atomic step.
        </p>
      </section>

      {feedback ? (
        <section className="panel">
          <span className="pill">{feedback}</span>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Needs review ({actionable.length})</h2>
            <p className="panel-copy">Approve to finalize the sale and post stock. Reject or cancel to close.</p>
          </div>
        </div>
        {actionable.length > 0 ? (
          <div className="stack">
            {actionable.map((order) => (
              <article key={order.id} className="ledger-card">
                <div className="ledger-card-top">
                  <div>
                    <strong>{order.customerName ?? 'Walk-in'}</strong>
                    <div className="eyebrow">
                      {order.status} · seller {order.sellerName ?? '—'} · {order.items.length} line(s)
                    </div>
                  </div>
                  <strong>{formatCurrency(order.total, tenant.currencyCode)}</strong>
                </div>
                <div className="stack">
                  {order.items.map((item) => (
                    <div key={item.id} className="list-row" style={{ borderTop: 0, paddingTop: 4 }}>
                      <div>
                        <strong>
                          [{item.itemType}] {item.itemName} × {item.quantity}
                        </strong>
                        <div className="eyebrow">
                          catalog {formatCurrency(item.catalogUnitPrice, tenant.currencyCode)} · charged{' '}
                          {formatCurrency(item.actualUnitPrice, tenant.currencyCode)}
                          {item.overrideReason ? ` · override: ${item.overrideReason}` : ''}
                        </div>
                      </div>
                      <strong>{formatCurrency(item.lineTotal, tenant.currencyCode)}</strong>
                    </div>
                  ))}
                </div>
                <div className="hero-actions" style={{ marginTop: 8 }}>
                  {isAdmin ? (
                    <form action={approveCommerceOrderAction}>
                      <input type="hidden" name="orderId" value={order.id} />
                      <button type="submit" className="button">
                        Approve to sale
                      </button>
                    </form>
                  ) : null}
                  {isAdmin ? (
                    <form action={rejectCommerceOrderAction}>
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="reason" value="Rejected from the order panel." />
                      <button type="submit" className="button secondary">
                        Reject
                      </button>
                    </form>
                  ) : null}
                  <form action={cancelCommerceOrderAction}>
                    <input type="hidden" name="orderId" value={order.id} />
                    <button type="submit" className="button secondary">
                      Cancel
                    </button>
                  </form>
                  <a className="button secondary" href={`/app/orders?orderId=${order.id}`}>
                    Inspect
                  </a>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="eyebrow">Nothing waiting for review.</div>
        )}
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>New order</h2>
              <p className="panel-copy">Mixed product/service carts. Totals are recomputed server-side.</p>
            </div>
          </div>
          <form action={createCommerceOrderAction} className="field-grid">
            <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
            <div className="field">
              <label htmlFor="customerId">Customer (optional walk-in)</label>
              <select id="customerId" name="customerId" defaultValue="">
                <option value="">Walk-in (no customer)</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="field-row">
                <div className="field">
                  <label htmlFor={`line_${index}_kind`}>Item {index + 1} — type (leave item blank to skip)</label>
                  <select id={`line_${index}_kind`} name={`line_${index}_kind`} defaultValue="service">
                    <option value="service">Service</option>
                    <option value="product">Product</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`line_${index}_refId`}>Item {index + 1} — product or service</label>
                  <select id={`line_${index}_refId`} name={`line_${index}_refId`} defaultValue="">
                    <option value="">—</option>
                    <optgroup label="Services">
                      {services.filter((service) => service.isActive).map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} · {formatCurrency(service.price, tenant.currencyCode)}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Products">
                      {products.filter((product) => product.isActive).map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                          {product.sellingPrice != null
                            ? ` · ${formatCurrency(product.sellingPrice, tenant.currencyCode)}`
                            : ' · needs pricing'}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <QuantityStepper
                  fieldName={`line_${index}_quantity`}
                  inputId={`line_${index}_quantity`}
                  label={`Item ${index + 1} — quantity`}
                />
                <div className="field">
                  <label htmlFor={`line_${index}_actual`}>Item {index + 1} — actual price (blank = catalog)</label>
                  <input id={`line_${index}_actual`} name={`line_${index}_actual`} type="number" min="0" step="1" />
                </div>
                <div className="field">
                  <label htmlFor={`line_${index}_reason`}>Item {index + 1} — override reason</label>
                  <input id={`line_${index}_reason`} name={`line_${index}_reason`} placeholder="Required if price differs" />
                </div>
              </div>
            ))}
            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" name="notes" />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Create order
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Recent sales ({sales.length})</h2>
              <p className="panel-copy">Completed commerce sales. Voids reverse stock with audit.</p>
            </div>
          </div>
          <div className="stack">
            {sales.slice(0, 10).map((sale) => (
              <div key={sale.id} className="list-row">
                <div>
                  <strong>{sale.customerName ?? 'Walk-in'}</strong>
                  <div className="eyebrow">
                    {sale.status} · {sale.items.length} line(s) · seller {sale.sellerName ?? '—'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <strong>{formatCurrency(sale.total, tenant.currencyCode)}</strong>
                  <a className="button secondary" href={`/app/orders?saleId=${sale.id}`}>
                    View
                  </a>
                  {isAdmin && sale.status === 'COMPLETED' ? (
                    <form action={voidCommerceSaleAction}>
                      <input type="hidden" name="saleId" value={sale.id} />
                      <input type="hidden" name="reason" value="Voided from the order panel." />
                      <button type="submit" className="button secondary">
                        Void
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {selectedOrder ? (
        <section className="panel">
          <h2>Order detail</h2>
          <p className="panel-copy">
            {selectedOrder.id} · {selectedOrder.status} · total {formatCurrency(selectedOrder.total, tenant.currencyCode)}
            {selectedOrder.paymentMethod ? ` · ${selectedOrder.paymentMethod}` : ''}
            {selectedOrder.customerPhone ? ` · ${selectedOrder.customerPhone}` : ''}
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
                    {item.overrideReason ? ` · ${item.overrideReason}` : ''} · commission{' '}
                    {formatCurrency(item.commissionAmount ?? 0, tenant.currencyCode)}
                  </div>
                </div>
                <strong>{formatCurrency(item.lineTotal, tenant.currencyCode)}</strong>
              </div>
            ))}
          </div>
          <div className="panel-header" style={{ marginTop: 16 }}>
            <div>
              <h3>Payments ({selectedOrderPayments.length})</h3>
              <p className="panel-copy">Masked phones; full numbers stay server-side. Cash shows as SUCCESS.</p>
            </div>
          </div>
          <div className="stack">
            {selectedOrderPayments.map((payment) => (
              <div key={payment.id} className="list-row">
                <div>
                  <strong>
                    {payment.method} · {payment.status}
                    {payment.needsRecovery ? ' · needs recovery' : ''}
                  </strong>
                  <div className="eyebrow">
                    {formatCurrency(payment.amount, payment.currencyCode)} · {payment.provider}
                    {payment.providerReference ? ` · ref ${payment.providerReference}` : ''} ·{' '}
                    {payment.customerPhone ? `phone ${payment.customerPhone}` : 'no phone'} ·{' '}
                    {payment.failureReason ? ` · ${payment.failureReason}` : ''}
                  </div>
                  <div className="eyebrow">
                    {payment.initiatedAt.slice(0, 16).replace('T', ' ')}
                    {payment.confirmedAt ? ` → ${payment.confirmedAt.slice(0, 16).replace('T', ' ')}` : ''}
                    {payment.expiresAt ? ` · expires ${payment.expiresAt.slice(0, 16).replace('T', ' ')}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {isAdmin && payment.status === 'SUCCESS' && payment.needsRecovery ? (
                    <form action={recoverPaidOrderAction}>
                      <input type="hidden" name="paymentId" value={payment.id} />
                      <input type="hidden" name="orderId" value={selectedOrder.id} />
                      <button type="submit" className="button secondary">
                        Recover sale
                      </button>
                    </form>
                  ) : null}
                </div>
              </div>
            ))}
            {selectedOrderPayments.length === 0 ? <div className="eyebrow">No payments yet.</div> : null}
          </div>
          {isAdmin && (selectedOrder.status === 'PENDING_REVIEW' || selectedOrder.status === 'APPROVED') ? (
            <div className="hero-actions" style={{ marginTop: 12 }}>
              <form action={retryOrderPaymentAction}>
                <input type="hidden" name="orderId" value={selectedOrder.id} />
                <button type="submit" className="button secondary">
                  Retry M-Pesa payment
                </button>
              </form>
              <form action={expireOverduePaymentsAction}>
                <button type="submit" className="button secondary">
                  Expire overdue intents
                </button>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}

      {selectedSale ? (
        <section className="panel">
          <h2>Sale detail</h2>
          <p className="panel-copy">
            {selectedSale.id} · {selectedSale.status} · total {formatCurrency(selectedSale.total, tenant.currencyCode)}
            {selectedSale.voidReason ? ` · void: ${selectedSale.voidReason}` : ''}
            {selectedSale.paymentMethod ? ` · ${selectedSale.paymentMethod}` : ''}
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
                    {item.overrideHistoryUnknown ? ' · historical override unknown' : ''}
                  </div>
                </div>
                <strong>{formatCurrency(item.lineTotal, tenant.currencyCode)}</strong>
              </div>
            ))}
          </div>
          {selectedSalePayments.length > 0 ? (
            <>
              <div className="panel-header" style={{ marginTop: 16 }}>
                <div>
                  <h3>Payments for this sale's order ({selectedSalePayments.length})</h3>
                </div>
              </div>
              <div className="stack">
                {selectedSalePayments.map((payment) => (
                  <div key={payment.id} className="list-row">
                    <div>
                      <strong>
                        {payment.method} · {payment.status}
                      </strong>
                      <div className="eyebrow">
                        {formatCurrency(payment.amount, payment.currencyCode)} · {payment.providerReference ?? 'no ref'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
