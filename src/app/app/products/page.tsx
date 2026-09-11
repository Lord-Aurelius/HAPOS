import { formatCurrency } from '@/lib/format';
import { getStockStatus } from '@/server/commerce/inventory';
import {
  addProductAction,
  adjustProductStockAction,
  updateProductAction,
} from '@/server/actions/hapos';
import { requireSession } from '@/server/auth/demo-session';
import { listInventoryMovements, listProducts } from '@/server/services/app-data';

type ProductsPageProps = {
  searchParams: Promise<{ productId?: string; success?: string; error?: string }>;
};

function getMessage(params: { success?: string; error?: string }) {
  if (params.error === 'invalid-price') {
    return 'Enter a valid cost and an optional valid selling price. Amounts cannot be negative or non-numeric.';
  }
  if (params.error === 'invalid-quantity') {
    return 'Quantities and thresholds must be whole numbers of zero or more.';
  }
  if (params.error === 'invalid-sku') {
    return 'SKUs may only contain letters, numbers, hyphens and underscores (max 64 characters).';
  }
  if (params.error === 'duplicate-sku') {
    return 'Another product in this shop already uses that SKU.';
  }
  if (params.error === 'invalid-threshold') {
    return 'Critical level cannot be higher than the reorder level.';
  }
  if (params.error === 'missing-name') {
    return 'Enter a product name before saving.';
  }
  if (params.error === 'unknown-product' || params.error === 'product-missing') {
    return 'That product could not be found for this shop.';
  }
  if (params.error === 'negative-stock') {
    return 'That stock change was rejected because there is not enough stock on hand.';
  }
  if (params.error === 'no-change') {
    return 'No adjustment was recorded: the counted quantity already matches, or opening stock already exists.';
  }
  if (params.error === 'adjustment-reason-required') {
    return 'Adjustments require a reason so the audit trail stays meaningful.';
  }
  if (params.error === 'product-update-failed') {
    return 'That product update could not be saved. Check the values and try again.';
  }
  if (params.success === 'added') {
    return 'Product added to the catalog.';
  }
  if (params.success === 'updated') {
    return 'Product catalog entry updated. Stock levels are unchanged — use an adjustment to correct counted stock.';
  }
  if (params.success === 'adjusted') {
    return 'Stock adjustment recorded with full audit history.';
  }
  return null;
}

function stockLabel(status: 'out_of_stock' | 'critical' | 'low' | 'in_stock') {
  return status === 'out_of_stock'
    ? 'Out of stock'
    : status === 'critical'
      ? 'Critical'
      : status === 'low'
        ? 'Low stock'
        : 'In stock';
}

export default async function ProductsPage({ searchParams }: ProductsPageProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const params = await searchParams;
  const [products, movements] = await Promise.all([
    listProducts(session.tenant.id),
    listInventoryMovements(session.tenant.id),
  ]);
  const feedback = getMessage(params);
  const selected = products.find((product) => product.id === params.productId) ?? null;
  const selectedMovements = selected
    ? movements.filter((movement) => movement.productId === selected.id).slice(0, 10)
    : [];

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Product catalog + inventory</p>
        <h1 className="hero-title">Track what gets used, not just what gets sold.</h1>
        <p className="hero-subtitle">
          Catalog edits never touch stock. Stock changes only through opening balances and audited
          adjustments — every movement records who, when, and why.
        </p>
      </section>

      {feedback ? (
        <section className="panel">
          <span className="pill">{feedback}</span>
        </section>
      ) : null}

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Add product</h2>
              <p className="panel-copy">Admins maintain the merchant-wide product catalog.</p>
            </div>
          </div>

          <form action={addProductAction} className="field-grid">
            <div className="field">
              <label htmlFor="name">Product name</label>
              <input id="name" name="name" required />
            </div>
            <div className="field">
              <label htmlFor="sku">SKU (optional)</label>
              <input id="sku" name="sku" placeholder="OIL-001" />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="unitCost">Cost price</label>
                <input id="unitCost" name="unitCost" type="number" min="0" step="1" required />
              </div>
              <div className="field">
                <label htmlFor="sellingPrice">Selling price (blank = needs pricing)</label>
                <input id="sellingPrice" name="sellingPrice" type="number" min="0" step="1" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="openingQuantity">Opening stock (0 = uncounted)</label>
                <input id="openingQuantity" name="openingQuantity" type="number" min="0" step="1" defaultValue="0" />
              </div>
              <div className="field">
                <label htmlFor="description">Description</label>
                <textarea id="description" name="description" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="reorderLevel">Reorder level (blank = no alert)</label>
                <input id="reorderLevel" name="reorderLevel" type="number" min="0" step="1" />
              </div>
              <div className="field">
                <label htmlFor="criticalLevel">Critical level (blank = no alert)</label>
                <input id="criticalLevel" name="criticalLevel" type="number" min="0" step="1" />
              </div>
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Add product
              </button>
            </div>
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Product list</h2>
              <p className="panel-copy">Select a product to edit its catalog entry or adjust counted stock.</p>
            </div>
          </div>

          <div className="stack">
            {products.map((product) => {
              const status = getStockStatus({
                quantityOnHand: product.quantityOnHand ?? 0,
                reorderLevel: product.reorderLevel ?? null,
                criticalLevel: product.criticalLevel ?? null,
              });
              return (
                <div key={product.id} className="list-row">
                  <div>
                    <strong>{product.name}</strong>
                    <div className="eyebrow">
                      {product.sku ?? 'No SKU'} · cost {formatCurrency(product.unitCost)}
                      {product.sellingPrice != null ? ` · sells ${formatCurrency(product.sellingPrice)}` : ' · needs pricing'} ·{' '}
                      {product.quantityOnHand ?? 0} on hand · {stockLabel(status)}
                      {product.isActive ? '' : ' · inactive'}
                    </div>
                  </div>
                  <a className="button secondary" href={`/app/products?productId=${product.id}`}>
                    Manage
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {selected ? (
        <section className="grid-two">
          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Edit {selected.name}</h2>
                <p className="panel-copy">Catalog edits never change stock levels.</p>
              </div>
            </div>

            <form action={updateProductAction} className="field-grid">
              <input type="hidden" name="productId" value={selected.id} />
              <div className="field">
                <label htmlFor="edit-name">Product name</label>
                <input id="edit-name" name="name" defaultValue={selected.name} required />
              </div>
              <div className="field">
                <label htmlFor="edit-sku">SKU</label>
                <input id="edit-sku" name="sku" defaultValue={selected.sku ?? ''} />
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="edit-unitCost">Cost price</label>
                  <input id="edit-unitCost" name="unitCost" type="number" min="0" step="1" defaultValue={selected.unitCost} required />
                </div>
                <div className="field">
                  <label htmlFor="edit-sellingPrice">Selling price</label>
                  <input
                    id="edit-sellingPrice"
                    name="sellingPrice"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={selected.sellingPrice ?? ''}
                  />
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="edit-reorderLevel">Reorder level</label>
                  <input
                    id="edit-reorderLevel"
                    name="reorderLevel"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={selected.reorderLevel ?? ''}
                  />
                </div>
                <div className="field">
                  <label htmlFor="edit-criticalLevel">Critical level</label>
                  <input
                    id="edit-criticalLevel"
                    name="criticalLevel"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={selected.criticalLevel ?? ''}
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="edit-description">Description</label>
                <textarea id="edit-description" name="description" defaultValue={selected.description ?? ''} />
              </div>
              <div className="field">
                <label htmlFor="edit-isActive">Availability</label>
                <select id="edit-isActive" name="isActive" defaultValue={selected.isActive ? 'true' : 'false'}>
                  <option value="true">Active (sellable)</option>
                  <option value="false">Inactive (hidden from catalog)</option>
                </select>
              </div>
              <div className="hero-actions">
                <button type="submit" className="button">
                  Save catalog entry
                </button>
              </div>
            </form>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <h2>Adjust stock ({selected.quantityOnHand ?? 0} on hand)</h2>
                <p className="panel-copy">Enter the physically counted quantity. The difference is recorded as an audited movement.</p>
              </div>
            </div>

            <form action={adjustProductStockAction} className="field-grid">
              <input type="hidden" name="productId" value={selected.id} />
              <div className="field">
                <label htmlFor="countedQuantity">Counted quantity</label>
                <input id="countedQuantity" name="countedQuantity" type="number" min="0" step="1" required />
              </div>
              <div className="field">
                <label htmlFor="reason">Reason (required)</label>
                <input id="reason" name="reason" placeholder="Monthly stock count" required />
              </div>
              <div className="hero-actions">
                <button type="submit" className="button">
                  Record adjustment
                </button>
              </div>
            </form>

            <div className="panel-header" style={{ marginTop: 24 }}>
              <div>
                <h2>Recent movements</h2>
                <p className="panel-copy">Why did stock change, and who changed it?</p>
              </div>
            </div>
            <div className="stack">
              {selectedMovements.length > 0 ? (
                selectedMovements.map((movement) => (
                  <div key={movement.id} className="list-row">
                    <div>
                      <strong>
                        {movement.movementType} ({movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity})
                      </strong>
                      <div className="eyebrow">
                        {movement.previousQuantity} → {movement.resultingQuantity}
                        {movement.reason ? ` · ${movement.reason}` : ''} ·{' '}
                        {movement.createdAt.slice(0, 16).replace('T', ' ')}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="eyebrow">No audited movements yet. Uncounted stock shows 0 until an opening balance or adjustment is recorded.</div>
              )}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
