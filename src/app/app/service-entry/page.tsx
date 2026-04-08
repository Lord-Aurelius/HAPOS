import { formatCurrency } from '@/lib/format';
import { recordServiceAction, updateCustomerOrderStatusAction } from '@/server/actions/hapos';
import { requireSession } from '@/server/auth/demo-session';
import { getStaffMetrics, listCustomerOrders, listCustomers, listProducts, listServices, listUsers } from '@/server/services/app-data';

type ServiceEntryPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function ServiceEntryPage({ searchParams }: ServiceEntryPageProps) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return null;
  }
  const tenant = session.tenant;

  const params = await searchParams;
  const [customers, customerOrders, services, users, products, metrics] = await Promise.all([
    listCustomers(tenant.id),
    listCustomerOrders(tenant.id, { status: 'pending' }),
    listServices(tenant.id),
    listUsers(tenant.id),
    listProducts(tenant.id),
    getStaffMetrics(tenant.id, session.user.id),
  ]);
  const staff = users.filter((user) => user.role === 'staff' || user.role === 'shop_admin');
  const hasServices = services.length > 0;

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Counter workflow</p>
        <h1 className="hero-title">Tap once, record once, move on.</h1>
        <p className="hero-subtitle">
          This screen is the operational center for staff. Price-list services stay one tap away, but custom services can still be recorded when a job sits outside the normal menu.
        </p>
      </section>

      {params.success || params.error ? (
        <div className="panel">
          <span className="pill">
            {params.error === 'custom-service'
              ? 'Enter a custom service name and price before saving.'
              : params.error === 'customer-required'
                ? 'Enter the customer name and phone number before saving.'
              : params.error === 'no-services'
                ? 'This shop has no price-list services yet. Use Custom service for now or add services first.'
                : params.error === 'staff-not-found'
                  ? 'The selected staff member is no longer available for this shop. Refresh and choose another staff member.'
                : params.error === 'service-not-found'
                  ? 'The selected price-list service is no longer available for this shop. Choose another service or use Custom service.'
                  : params.error === 'request-invalid'
                    ? 'That customer request update was not valid.'
                    : params.success === 'request-updated'
                      ? 'Customer request queue updated. Acknowledged bookings now wait in Sales for admin approval.'
                  : 'Service recorded and thank-you SMS queued.'}
          </span>
        </div>
      ) : null}

      {!hasServices ? (
        <section className="panel">
          <span className="pill">
            No price-list services are configured for this tenant yet. Custom service mode is available so work can continue.
          </span>
        </section>
      ) : null}

      <section className="service-entry-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Record completed service</h2>
              <p className="panel-copy">
                Staff can choose a predefined service or record an off-menu custom service. Customer phone remains the anchor for visit history.
              </p>
            </div>
            <span className="pill">{tenant.name}</span>
          </div>

          <form action={recordServiceAction} className="field-grid">
            <div className="field">
              <label htmlFor="customerName">Customer name</label>
              <input id="customerName" name="customerName" placeholder="Kevin Mwangi" required />
            </div>
            <div className="field">
              <label htmlFor="customerPhone">Customer phone in +254 format</label>
              <input id="customerPhone" name="customerPhone" placeholder="+254711000101" required />
            </div>
            {session.user.role !== 'staff' ? (
              <div className="field">
                <label htmlFor="staffId">Staff member</label>
                <select id="staffId" name="staffId" defaultValue={session.user.id}>
                  {staff.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.fullName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="serviceMode">Service source</label>
              <select id="serviceMode" name="serviceMode" defaultValue={hasServices ? 'price-list' : 'custom'}>
                <option value="price-list">Use price list</option>
                <option value="custom">Custom service</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="serviceId">Price list service</label>
              <select id="serviceId" name="serviceId" defaultValue={services[0]?.id ?? ''}>
                {services.length > 0 ? (
                  services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name} · {formatCurrency(service.price)}
                  </option>
                  ))
                ) : (
                  <option value="">No services configured</option>
                )}
              </select>
            </div>
            <div className="field">
              <label htmlFor="customServiceName">Custom service name</label>
              <input id="customServiceName" name="customServiceName" placeholder="Home Service Beard Trim" />
            </div>
            <div className="field">
              <label htmlFor="customPrice">Custom price</label>
              <input id="customPrice" name="customPrice" type="number" min="0" step="1" placeholder="1000" />
            </div>
            <div className="field">
              <label htmlFor="productId">Used product</label>
              <select id="productId" name="productId" defaultValue="">
                <option value="">No product recorded</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {formatCurrency(product.unitCost)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="productQuantity">Product quantity</label>
              <input id="productQuantity" name="productQuantity" type="number" min="0" step="1" defaultValue="1" />
            </div>
            <div className="field">
              <label htmlFor="description">Service notes</label>
              <textarea id="description" name="description" placeholder="Low fade and beard line-up" />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">
                Save service
              </button>
            </div>
          </form>
        </section>

        <section className="panel stack">
          <div>
            <h3>Your current numbers</h3>
            <p className="panel-copy">Staff can always see what they sold, how many clients they served, and what they earned.</p>
          </div>
          <div className="list-row">
            <div>
              <strong>Today</strong>
              <div className="eyebrow">{metrics.todayClients} clients</div>
            </div>
            <div>
              <strong>{formatCurrency(metrics.todaySales)}</strong>
              <div className="eyebrow">{formatCurrency(metrics.todayCommission)} earned</div>
            </div>
          </div>
          <div className="list-row">
            <div>
              <strong>This month</strong>
              <div className="eyebrow">{metrics.monthClients} clients</div>
            </div>
            <div>
              <strong>{formatCurrency(metrics.monthSales)}</strong>
              <div className="eyebrow">{formatCurrency(metrics.monthCommission)} earned</div>
            </div>
          </div>
          <div>
            <h4>Recent customers</h4>
            <div className="stack">
              {customers.slice(0, 5).map((customer) => (
                <div key={customer.id} className="list-row">
                  <div>
                    <strong>{customer.name}</strong>
                    <div className="eyebrow">{customer.phoneE164}</div>
                  </div>
                  <div className="eyebrow">{customer.totalVisits ?? 0} visits</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Customer request queue</h2>
            <p className="panel-copy">Requests from the public booking link land here first. Acknowledge one to move it into Sales where an admin can approve it into the ledger.</p>
          </div>
          <span className="pill">{customerOrders.length} pending</span>
        </div>

        {customerOrders.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Requested service</th>
                <th>Preferred staff</th>
                <th>Notes</th>
                <th>Requested</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {customerOrders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.customerName}</strong>
                    <div className="eyebrow">{order.customerPhone}</div>
                  </td>
                  <td>
                    <strong>{order.serviceName}</strong>
                    <div className="eyebrow">{formatCurrency(order.quotedPrice, tenant.currencyCode)}</div>
                  </td>
                  <td>{order.requestedStaffName || 'No preference'}</td>
                  <td>{order.notes || 'No notes'}</td>
                  <td>{order.requestedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    <div style={{ display: 'grid', gap: 8 }}>
                      <form action={updateCustomerOrderStatusAction}>
                        <input type="hidden" name="orderId" value={order.id} />
                        <input type="hidden" name="nextStatus" value="acknowledged" />
                        <input type="hidden" name="redirectTo" value="/app/service-entry?success=request-updated" />
                        <button type="submit" className="button secondary" style={{ minHeight: 38 }}>
                          Send to admin approval
                        </button>
                      </form>
                      <form action={updateCustomerOrderStatusAction}>
                        <input type="hidden" name="orderId" value={order.id} />
                        <input type="hidden" name="nextStatus" value="cancelled" />
                        <input type="hidden" name="redirectTo" value="/app/service-entry?success=request-updated" />
                        <button type="submit" className="button secondary" style={{ minHeight: 38 }}>
                          Cancel
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="eyebrow">No pending requests from customers right now.</div>
        )}
      </section>
    </>
  );
}
