import { formatCurrency } from '@/lib/format';
import { SellerError } from '@/server/commerce/seller';
import { checkSellerRateLimit } from '@/server/auth/seller-limit';
import { getSellerQrContext, retrySellerQrPaymentAction, submitSellerQrOrderAction } from '@/server/actions/seller';
import { getSellerCommerceRepository } from '@/server/commerce/seller-context';
import { QuantityStepper } from '@/components/cart/quantity-stepper';
import { getMpesaAvailability } from '@/server/payments/payment-service';

type SellPageProps = {
  params: Promise<{ reference: string }>;
  searchParams: Promise<{ k?: string; orderId?: string; saleId?: string; success?: string; error?: string }>;
};

function getErrorMessage(error?: string) {
  const messages: Record<string, string> = {
    'invalid-reference': 'This seller QR code is not recognized.',
    'invalid-bearer': 'This seller QR code is not recognized.',
    'credential-revoked': 'This seller QR code is no longer active. Ask an admin for a new one.',
    'credential-expired': 'This seller QR code has expired. Ask an admin for a new one.',
    'inactive-seller': 'That seller account is inactive.',
    'empty-order': 'Add at least one product or service line.',
    'unknown-item': 'One of the selected items was not found for this shop.',
    'inactive-item': 'One of the selected items is not currently sellable.',
    'needs-pricing': 'A selected product has no selling price yet.',
    'invalid-price': 'Prices must be valid amounts of zero or more.',
    'invalid-quantity': 'Quantities must be positive whole numbers.',
    'override-reason-required': 'Price changes need a reason.',
    'insufficient-stock': 'Insufficient stock — the sale was blocked and nothing was deducted.',
    'rate-limited': 'Too many attempts. Wait a few minutes and try again.',
    'invalid-phone': 'Enter a valid Kenyan M-Pesa number (e.g. 0712345678).',
    'connection-not-connected': 'M-Pesa is not connected for this shop. Ask the shop admin to connect payments.',
    'connection-environment-mismatch': 'The shop payment connection belongs to a different environment.',
    'connection-secret-unavailable': 'Payment connection credentials are unavailable. Reconnect payments in settings.',
    'gateway-unconfigured': 'Payment provider is not configured. Cash works; M-Pesa needs staging setup.',
    'gateway-rejected': 'Payment provider rejected the request. Try again.',
    'gateway-timeout': 'Payment provider did not respond. Try again.',
  };
  return (error && messages[error]) || null;
}

export default async function SellerQrPage({ params, searchParams }: SellPageProps) {
  const { reference } = await params;
  const query = await searchParams;
  const bearer = query.k ?? '';
  const allowed = bearer ? checkSellerRateLimit(reference) : true;

  let context: Awaited<ReturnType<typeof getSellerQrContext>> | null = null;
  let contextError: string | null = allowed ? null : getErrorMessage('rate-limited');
  if (bearer && allowed) {
    try {
      context = await getSellerQrContext(reference, bearer);
    } catch (error) {
      contextError = error instanceof SellerError ? getErrorMessage(error.code) : getErrorMessage('invalid-reference');
    }
  }

  const repo = context ? getSellerCommerceRepository(context.backend) : null;
  const catalog = context && repo ? await repo.getCatalogProducts(context.tenantId).then(async (products) => {
    const services = await repo.getCatalogServices(context!.tenantId);
    return [
      ...products.filter((p) => p.isActive).map((p) => ({ id: p.id, type: 'product' as const, name: p.name, catalogPrice: p.sellingPrice, isActive: p.isActive })),
      ...services.filter((s) => s.isActive).map((s) => ({ id: s.id, type: 'service' as const, name: s.name, catalogPrice: s.price, isActive: s.isActive })),
    ];
  }) : [];
  // Receipt: repository-scoped (works in file and SQL modes).
  let receipt: {
    orderTotal: number;
    orderStatus: string;
    paymentMethod: string | null;
    customerPhone: string | null;
    paymentStatus: string | null;
    saleTotal: number | null;
    lines: { name: string; quantity: number; lineTotal: number }[];
  } | null = null;
  if (context && query.orderId && repo) {
    const order = await repo.getOrderView(context.tenantId, query.orderId);
    if (order && order.sellerId === context.sellerId) {
      const items = order.items;
      const sale = query.saleId ? await repo.getSaleView(context.tenantId, query.saleId) : null;
      const payments = await repo.listPayments(context.tenantId, { orderId: order.id });
      const latestPayment = payments[0] ?? null;
      receipt = {
        orderTotal: order.total,
        orderStatus: order.status,
        paymentMethod: order.paymentMethod ?? null,
        customerPhone: order.customerPhone ?? null,
        paymentStatus: latestPayment?.status ?? null,
        saleTotal: sale ? sale.total : null,
        lines: items.map((item) => ({ name: item.itemName, quantity: item.quantity, lineTotal: item.lineTotal })),
      };
    }
  }

  // M-Pesa readiness is a server-side fact resolved against the same store
  // that verified the QR (never a predictable provider error).
  const mpesa = context && repo ? await getMpesaAvailability(repo, context.tenantId) : { available: false, reason: 'payment-not-connected', connectionId: null };

  const feedback = getErrorMessage(query.error) ?? (query.success === 'order-duplicate' ? 'That submission was already recorded.' : null);

  return (
    <main className="login-shell">
      <section className="login-card" style={{ maxWidth: 640, margin: '32px auto' }}>
        <p className="hero-kicker">
          Seller checkout{context ? ` · ${context.tenantName ?? ''} · ${context.sellerName ?? ''}` : ''}
        </p>
        <h1 className="section-title">Record a sale</h1>

        {(contextError || feedback) && (
          <p className="pill" style={{ marginTop: 12, background: 'rgba(160, 60, 46, 0.12)', color: 'var(--danger)' }}>
            {contextError ?? feedback}
          </p>
        )}

        {!bearer || !context ? (
          <p className="muted" style={{ marginTop: 16 }}>
            {!bearer
              ? 'This seller link is missing its credential. Scan the seller QR code to begin.'
              : (contextError ?? 'This seller QR code is not recognized.')}
          </p>
        ) : receipt ? (
          <div className="stack" style={{ marginTop: 16 }}>
            <h2>{receipt.saleTotal !== null ? 'Sale completed' : receipt.paymentStatus === 'PENDING' ? 'Payment pending' : `Order ${receipt.orderStatus}`}</h2>
            <div className="stack">
              {receipt.lines.map((line, index) => (
                <div key={index} className="list-row">
                  <div>
                    <strong>
                      {line.name} × {line.quantity}
                    </strong>
                  </div>
                  <strong>{formatCurrency(line.lineTotal, context.currencyCode)}</strong>
                </div>
              ))}
            </div>
            <p className="muted">
              Total {formatCurrency(receipt.saleTotal ?? receipt.orderTotal, context.currencyCode)}
              {receipt.saleTotal === null
                ? receipt.paymentStatus === 'PENDING'
                  ? ` · Payment pending — awaiting customer confirmation${receipt.customerPhone ? ` (${receipt.customerPhone})` : ''}`
                  : receipt.paymentStatus === 'FAILED'
                    ? ' · Payment failed — retry below'
                    : receipt.paymentMethod === 'MPESA'
                      ? ` · M-Pesa order held for payment${receipt.customerPhone ? ` (${receipt.customerPhone})` : ''}`
                      : ' · waiting for admin review'
                : ` · ${receipt.paymentMethod ?? 'CASH'} · ${receipt.paymentStatus ?? 'paid'}`}
            </p>
            {receipt.paymentMethod === 'MPESA' && receipt.saleTotal === null && (
              <form action={retrySellerQrPaymentAction} className="field-grid">
                <input type="hidden" name="reference" value={reference} />
                <input type="hidden" name="bearer" value={bearer} />
                <input type="hidden" name="orderId" value={query.orderId ?? ''} />
                <div className="hero-actions" style={{ marginTop: 0 }}>
                  <button type="submit" className="button">
                    Retry M-Pesa payment
                  </button>
                </div>
              </form>
            )}
            <a className="button secondary" href={`/sell/${reference}?k=${encodeURIComponent(bearer)}`}>
              New sale
            </a>
          </div>
        ) : (
          <form action={submitSellerQrOrderAction} className="field-grid" style={{ marginTop: 16 }}>
            <input type="hidden" name="reference" value={reference} />
            <input type="hidden" name="bearer" value={bearer} />
            <input type="hidden" name="idempotencyKey" value={`${reference.slice(0, 8)}-${Date.now().toString(36)}`} />
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
                      {catalog.filter((item) => item.type === 'service' && item.isActive).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.catalogPrice !== null ? formatCurrency(item.catalogPrice, context.currencyCode) : 'unpriced'}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Products">
                      {catalog.filter((item) => item.type === 'product' && item.isActive).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.catalogPrice !== null ? ` · ${formatCurrency(item.catalogPrice, context.currencyCode)}` : ' · needs pricing'}
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
                  <label htmlFor={`line_${index}_reason`}>Item {index + 1} — price reason</label>
                  <input id={`line_${index}_reason`} name={`line_${index}_reason`} placeholder="If price differs" />
                </div>
              </div>
            ))}
            <div className="field">
              <label htmlFor="notes">Notes</label>
              <textarea id="notes" name="notes" />
            </div>
            <div className="field">
              <span className="eyebrow">Payment method</span>
              <div className="field-row">
                <label>
                  <input type="radio" name="paymentMethod" value="cash" defaultChecked /> Cash — completes
                  immediately
                </label>
                <label>
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="mpesa"
                    disabled={!mpesa.available}
                  />{' '}
                  {mpesa.available
                    ? 'M-Pesa — sends an STK push to the customer'
                    : 'M-Pesa unavailable for this shop.'}
                </label>
              </div>
            </div>
            <div className="field">
              <label htmlFor="customerPhone">Customer M-Pesa number (required for M-Pesa, e.g. 0712345678)</label>
              <input id="customerPhone" name="customerPhone" inputMode="tel" placeholder="07XXXXXXXX" />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Submit sale
              </button>
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
