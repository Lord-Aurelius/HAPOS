import { formatCurrency } from '@/lib/format';
import { SellerError } from '@/server/commerce/seller';
import { checkSellerRateLimit } from '@/server/auth/seller-limit';
import { getSellerQrContext, submitSellerQrOrderAction } from '@/server/actions/seller';
import { getCatalog } from '@/server/services/app-data';
import { readStore } from '@/server/store';

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

  const catalog = context ? await getCatalog(context.tenantId) : [];
  const store = context ? await readStore() : null;

  // Receipt: tenant- and seller-scoped read of the just-created order/sale.
  let receipt: {
    orderTotal: number;
    orderStatus: string;
    saleTotal: number | null;
    lines: { name: string; quantity: number; lineTotal: number }[];
  } | null = null;
  if (context && store && query.orderId) {
    const order = (store.orders ?? []).find(
      (item) => item.id === query.orderId && item.tenantId === context!.tenantId && item.sellerId === context!.sellerId,
    );
    if (order) {
      const items = (store.orderItems ?? []).filter((item) => item.orderId === order.id);
      const sale = query.saleId
        ? (store.sales ?? []).find((item) => item.id === query.saleId && item.tenantId === context!.tenantId)
        : null;
      receipt = {
        orderTotal: order.total,
        orderStatus: order.status,
        saleTotal: sale ? sale.total : null,
        lines: items.map((item) => ({ name: item.itemName, quantity: item.quantity, lineTotal: item.lineTotal })),
      };
    }
  }

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
            <h2>{receipt.saleTotal !== null ? 'Sale completed' : `Order ${receipt.orderStatus}`}</h2>
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
              {receipt.saleTotal === null ? ' · waiting for admin review' : ''}
            </p>
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
                <div className="field">
                  <label htmlFor={`line_${index}_quantity`}>Item {index + 1} — quantity</label>
                  <input id={`line_${index}_quantity`} name={`line_${index}_quantity`} type="number" min="0" step="1" />
                </div>
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
