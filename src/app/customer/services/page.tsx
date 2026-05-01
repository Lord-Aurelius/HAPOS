import { CustomerShell } from '@/components/shell/customer-shell';
import { formatCurrency } from '@/lib/format';
import { requireCustomerSession } from '@/server/auth/customer-session';
import { listServices } from '@/server/services/app-data';

export default async function CustomerServicesPage() {
  const session = await requireCustomerSession();
  const services = await listServices(session.tenant.id);

  return (
    <CustomerShell session={session}>
      <section className="hero">
        <p className="hero-kicker">Price list</p>
        <h1 className="hero-title">See the current services before your next visit.</h1>
        <p className="hero-subtitle">
          This is the same price list the shop team sees, including service photos and descriptions where the admin has added them.
        </p>
      </section>

      <section className="panel">
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
                <div>
                  <h3 style={{ marginTop: 0 }}>{service.name}</h3>
                  <p className="panel-copy">{service.description || 'No description added yet.'}</p>
                </div>
                <div className="list-row">
                  <div>
                    <strong>Price</strong>
                    <div className="eyebrow">{formatCurrency(service.price, session.tenant.currencyCode)}</div>
                  </div>
                  <div>
                    <strong>Duration</strong>
                    <div className="eyebrow">{service.durationMinutes ? `${service.durationMinutes} min` : 'Flexible'}</div>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </CustomerShell>
  );
}
