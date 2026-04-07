import { formatCurrency } from '@/lib/format';
import { addProductAction } from '@/server/actions/hapos';
import { requireSession } from '@/server/auth/demo-session';
import { listProducts } from '@/server/services/app-data';

export default async function ProductsPage() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const products = await listProducts(session.tenant.id);

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Product cost tracking</p>
        <h1 className="hero-title">Track what gets used, not just what gets sold.</h1>
        <p className="hero-subtitle">
          Monthly reports can only surface the most-used products and their costs if product usage is captured during service entry.
        </p>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Add product</h2>
              <p className="panel-copy">Admins maintain the product catalog used in service records and monthly cost reports.</p>
            </div>
          </div>

          <form action={addProductAction} className="field-grid">
            <div className="field">
              <label htmlFor="name">Product name</label>
              <input id="name" name="name" required />
            </div>
            <div className="field">
              <label htmlFor="unitCost">Unit cost</label>
              <input id="unitCost" name="unitCost" type="number" min="0" step="1" required />
            </div>
            <div className="field">
              <label htmlFor="description">Description</label>
              <textarea id="description" name="description" />
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
              <p className="panel-copy">These products become available inside service entry so costs can be attached to each job.</p>
            </div>
          </div>

          <div className="stack">
            {products.map((product) => (
              <div key={product.id} className="list-row">
                <div>
                  <strong>{product.name}</strong>
                  <div className="eyebrow">{product.description}</div>
                </div>
                <strong>{formatCurrency(product.unitCost)}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
