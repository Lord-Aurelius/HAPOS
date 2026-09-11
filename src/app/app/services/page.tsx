import { formatCurrency } from '@/lib/format';
import {
  addServiceAction,
  setServiceConsumptionAction,
  updateServiceAction,
  updateServiceImageAction,
} from '@/server/actions/hapos';
import { requireSession } from '@/server/auth/demo-session';
import { listProducts, listServiceProductLinks, listServices } from '@/server/services/app-data';

type ServicesPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

function getMessage(params: { success?: string; error?: string }) {
  if (params.error === 'image-upload') {
    return 'Upload a valid image file before saving the service picture.';
  }

  if (params.error === 'invalid-price') {
    return 'Enter a valid service price before saving. Prices cannot be blank, negative, or non-numeric.';
  }

  if (params.error === 'invalid-quantity') {
    return 'Enter a whole-number duration in minutes, or leave it blank.';
  }

  if (params.error === 'missing-name') {
    return 'Enter a service name before saving to the price list.';
  }

  if (params.error === 'service-missing') {
    return 'That service could not be found for this shop.';
  }

  if (params.error === 'unknown-product') {
    return 'One of the selected consumed products is not available for this shop.';
  }

  if (params.error === 'invalid-quantity') {
    return 'Consumption quantities must be positive whole numbers.';
  }

  if (params.success === 'updated') {
    return 'Service price-list entry updated.';
  }

  if (params.success === 'consumption-updated') {
    return 'Service consumption definition saved. No stock moved — it applies to future sales only.';
  }

  if (params.success === 'image-updated') {
    return 'Service image updated. Staff and customers will now see the new visual in the price list.';
  }

  if (params.success === 'added') {
    return 'Service added to the official price list.';
  }

  return null;
}

export default async function ServicesPage({ searchParams }: ServicesPageProps) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return null;
  }

  const params = await searchParams;
  const [services, products, consumptionLinks] = await Promise.all([
    listServices(session.tenant.id),
    listProducts(session.tenant.id),
    listServiceProductLinks(session.tenant.id),
  ]);
  const feedback = getMessage(params);

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Price list control</p>
        <h1 className="hero-title">One source of truth for every service price.</h1>
        <p className="hero-subtitle">
          The published price list stays controlled by admins, while staff can still record valid off-menu work from the service-entry screen when a job falls outside the standard menu.
        </p>
      </section>

      {feedback ? (
        <section className="panel">
          <span className="pill">{feedback}</span>
        </section>
      ) : null}

      {session.user.role !== 'staff' ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Add service to the price list</h2>
              <p className="panel-copy">Admins define the official menu, pricing, and default commission rules.</p>
            </div>
          </div>

          <form action={addServiceAction} className="field-grid">
            <div className="field">
              <label htmlFor="name">Service name</label>
              <input id="name" name="name" required />
            </div>
            <div className="field">
              <label htmlFor="price">Price</label>
              <input id="price" name="price" type="number" min="0" step="1" required />
            </div>
            <div className="field">
              <label htmlFor="description">Description</label>
              <textarea id="description" name="description" />
            </div>
            <div className="field">
              <label htmlFor="imageFile">Service photo from this computer</label>
              <input id="imageFile" name="imageFile" type="file" accept="image/*" />
            </div>
            <div className="field">
              <label htmlFor="commissionType">Default commission type</label>
              <select id="commissionType" name="commissionType">
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="commissionValue">Default commission value</label>
              <input id="commissionValue" name="commissionValue" type="number" min="0" step="1" required />
            </div>
            <div className="field">
              <label htmlFor="durationMinutes">Duration (minutes)</label>
              <input id="durationMinutes" name="durationMinutes" type="number" min="0" step="1" />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Add service
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Published services</h2>
            <p className="panel-copy">Staff and customers can view the same polished price list with service descriptions and photos.</p>
          </div>
          <span className="pill">{session.user.role === 'staff' ? 'View only' : 'Admin-controlled'}</span>
        </div>

        <div className="service-grid">
          {services.map((service) => (
            <article className="service-card" key={service.id}>
              <div className="service-card-media">
                {service.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={service.imageUrl}
                    alt={service.name}
                    className="service-card-image"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="service-card-placeholder">No photo yet</div>
                )}
              </div>

              <div className="stack">
                <div className="list-row" style={{ borderTop: 0, paddingTop: 0 }}>
                  <div>
                    <strong>{service.name}</strong>
                    <div className="eyebrow">{service.description || 'No description added yet.'}</div>
                  </div>
                  <strong>{formatCurrency(service.price)}</strong>
                </div>

                <div className="list-row">
                  <div>
                    <strong>Commission</strong>
                    <div className="eyebrow">
                      {service.commissionType === 'fixed'
                        ? formatCurrency(service.commissionValue)
                        : `${service.commissionValue}%`}
                    </div>
                  </div>
                  <div>
                    <strong>Duration</strong>
                    <div className="eyebrow">{service.durationMinutes ? `${service.durationMinutes} min` : 'Flexible'}</div>
                  </div>
                </div>

                {session.user.role !== 'staff' ? (
                  <form action={updateServiceImageAction} className="field-grid">
                    <input type="hidden" name="serviceId" value={service.id} />
                    <div className="field">
                      <label htmlFor={`service-image-${service.id}`}>Replace service photo</label>
                      <input id={`service-image-${service.id}`} name="imageFile" type="file" accept="image/*" />
                    </div>
                    <div className="hero-actions" style={{ marginTop: 0 }}>
                      <button type="submit" className="button secondary">
                        Save photo
                      </button>
                    </div>
                  </form>
                ) : null}

                {session.user.role !== 'staff' ? (
                  <form action={updateServiceAction} className="field-grid">
                    <input type="hidden" name="serviceId" value={service.id} />
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor={`service-name-${service.id}`}>Service name</label>
                        <input id={`service-name-${service.id}`} name="name" defaultValue={service.name} required />
                      </div>
                      <div className="field">
                        <label htmlFor={`service-price-${service.id}`}>Price</label>
                        <input
                          id={`service-price-${service.id}`}
                          name="price"
                          type="number"
                          min="0"
                          step="1"
                          defaultValue={service.price}
                          required
                        />
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor={`service-duration-${service.id}`}>Duration (minutes)</label>
                        <input
                          id={`service-duration-${service.id}`}
                          name="durationMinutes"
                          type="number"
                          min="0"
                          step="1"
                          defaultValue={service.durationMinutes ?? ''}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`service-active-${service.id}`}>Availability</label>
                        <select
                          id={`service-active-${service.id}`}
                          name="isActive"
                          defaultValue={service.isActive ? 'true' : 'false'}
                        >
                          <option value="true">Active (sellable)</option>
                          <option value="false">Inactive</option>
                        </select>
                      </div>
                    </div>
                    <div className="field-row">
                      <div className="field">
                        <label htmlFor={`service-commission-type-${service.id}`}>Commission type</label>
                        <select
                          id={`service-commission-type-${service.id}`}
                          name="commissionType"
                          defaultValue={service.commissionType}
                        >
                          <option value="percentage">Percentage</option>
                          <option value="fixed">Fixed</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`service-commission-value-${service.id}`}>Commission value</label>
                        <input
                          id={`service-commission-value-${service.id}`}
                          name="commissionValue"
                          type="number"
                          min="0"
                          step="1"
                          defaultValue={service.commissionValue}
                        />
                      </div>
                    </div>
                    <div className="field">
                      <label htmlFor={`service-description-${service.id}`}>Description</label>
                      <textarea
                        id={`service-description-${service.id}`}
                        name="description"
                        defaultValue={service.description ?? ''}
                      />
                    </div>
                    <div className="hero-actions" style={{ marginTop: 0 }}>
                      <button type="submit" className="button secondary">
                        Save price-list entry
                      </button>
                    </div>
                  </form>
                ) : null}

                {session.user.role !== 'staff' ? (
                  <form action={setServiceConsumptionAction} className="field-grid">
                    <input type="hidden" name="serviceId" value={service.id} />
                    <div className="field">
                      <span className="eyebrow">Consumed products (definition only — no stock moves until a sale)</span>
                      {products.length > 0 ? (
                        <div className="stack">
                          {products.map((product) => {
                            const existing = consumptionLinks.find(
                              (link) => link.serviceId === service.id && link.productId === product.id,
                            );
                            return (
                              <div key={product.id} className="list-row" style={{ borderTop: 0, paddingTop: 4 }}>
                                <div>
                                  <strong>{product.name}</strong>
                                </div>
                                <input
                                  name={`bom_${product.id}`}
                                  type="number"
                                  min="0"
                                  step="1"
                                  defaultValue={existing?.quantity ?? ''}
                                  placeholder="0"
                                  aria-label={`Quantity of ${product.name} consumed per service`}
                                  style={{ maxWidth: 96 }}
                                />
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="eyebrow">Add products to the catalog first.</div>
                      )}
                    </div>
                    <div className="hero-actions" style={{ marginTop: 0 }}>
                      <button type="submit" className="button secondary">
                        Save consumption
                      </button>
                    </div>
                  </form>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
