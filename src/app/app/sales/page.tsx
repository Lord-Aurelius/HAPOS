import Link from 'next/link';

import { formatCurrency, formatDateTime } from '@/lib/format';
import { updateServiceRecordAction } from '@/server/actions/hapos';
import { requireSession } from '@/server/auth/demo-session';
import { listAllCustomers, listProducts, listServiceRecords, listServices, listUsers } from '@/server/services/app-data';

type SalesPageProps = {
  searchParams: Promise<{ recordId?: string; success?: string; error?: string }>;
};

function toDateTimeLocalValue(iso: string) {
  const date = new Date(iso);
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return adjusted.toISOString().slice(0, 16);
}

function getMessage(params: { success?: string; error?: string }) {
  if (params.error === 'custom-service') {
    return 'Enter a custom service name and price before saving the correction.';
  }

  if (params.error === 'invalid-date') {
    return 'Enter a valid service date and time before saving.';
  }

  if (params.success === 'record-updated') {
    return 'Sale correction saved. Dashboard, commissions, and reports now reflect the change.';
  }

  return null;
}

export default async function SalesPage({ searchParams }: SalesPageProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }
  const tenant = session.tenant;

  const params = await searchParams;
  const [records, services, staff, products, customers] = await Promise.all([
    listServiceRecords(tenant.id),
    listServices(tenant.id),
    listUsers(tenant.id),
    listProducts(tenant.id),
    listAllCustomers(tenant.id),
  ]);

  const visibleStaff = staff.filter((user) => user.role === 'shop_admin' || user.role === 'staff');
  const selectedRecord =
    records.find((record) => record.id === params.recordId) ??
    records[0] ??
    null;
  const selectedCustomer = selectedRecord ? customers.find((customer) => customer.id === selectedRecord.customerId) ?? null : null;
  const feedback = getMessage(params);
  const firstUsage = selectedRecord?.productUsages?.[0];

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Sales ledger</p>
        <h1 className="hero-title">Correct mistakes without breaking the books.</h1>
        <p className="hero-subtitle">
          Shop admins can review every sale, fix customer or service mistakes, and trust HAPOS to refresh commissions,
          customer history, dashboards, and monthly reports everywhere else.
        </p>
      </section>

      {feedback ? (
        <section className="panel">
          <span className="pill">{feedback}</span>
        </section>
      ) : null}

      <section className="sales-ledger-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Recorded sales</h2>
              <p className="panel-copy">Pick a sale to review or correct. Each change is tracked with who corrected it and when.</p>
            </div>
            <span className="pill">{records.length} jobs</span>
          </div>

          <div className="stack">
            {records.length === 0 ? (
              <p className="muted">No services have been recorded yet.</p>
            ) : (
              records.map((record) => (
                <Link
                  key={record.id}
                  href={`/app/sales?recordId=${record.id}`}
                  className="ledger-card"
                  data-active={record.id === selectedRecord?.id}
                >
                  <div className="ledger-card-top">
                    <div>
                      <strong>{record.customerName}</strong>
                      <div className="eyebrow">
                        {record.serviceName} with {record.staffName}
                      </div>
                    </div>
                    <strong>{formatCurrency(record.price, tenant.currencyCode)}</strong>
                  </div>
                  <div className="ledger-card-bottom">
                    <span className="eyebrow">{formatDateTime(record.performedAt)}</span>
                    {record.correctedAt ? (
                      <span className="pill">Corrected by {record.correctedByName ?? 'Admin'}</span>
                    ) : (
                      <span className="eyebrow">Original entry</span>
                    )}
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Sale correction</h2>
              <p className="panel-copy">
                Update the customer, service, price, product usage, or staff. Once saved, the correction flows into every
                tenant report.
              </p>
            </div>
            {selectedRecord ? (
              <Link href={`/app/receipts/${selectedRecord.id}`} className="button secondary">
                View receipt
              </Link>
            ) : null}
          </div>

          {selectedRecord ? (
            <div className="stack">
              <div className="sales-context">
                <div className="list-row">
                  <div>
                    <strong>Current sale</strong>
                    <div className="eyebrow">
                      {selectedRecord.customerName} / {selectedRecord.serviceName} / {selectedRecord.staffName}
                    </div>
                  </div>
                  <strong>{formatCurrency(selectedRecord.price, tenant.currencyCode)}</strong>
                </div>
                <div className="list-row">
                  <div>
                    <strong>Recorded at</strong>
                    <div className="eyebrow">{formatDateTime(selectedRecord.performedAt)}</div>
                  </div>
                  <div className="eyebrow">
                    {selectedRecord.correctedAt
                      ? `Last corrected ${formatDateTime(selectedRecord.correctedAt)} by ${selectedRecord.correctedByName ?? 'Admin'}`
                      : 'No correction has been made yet.'}
                  </div>
                </div>
              </div>

              <form action={updateServiceRecordAction} className="field-grid">
                <input type="hidden" name="recordId" value={selectedRecord.id} />
                <input type="hidden" name="tenantId" value={tenant.id} />
                <input type="hidden" name="redirectTo" value={`/app/sales?recordId=${selectedRecord.id}&success=record-updated`} />

                <div className="field">
                  <label htmlFor="customerName">Customer name</label>
                  <input id="customerName" name="customerName" defaultValue={selectedRecord.customerName ?? ''} required />
                </div>
                <div className="field">
                  <label htmlFor="customerPhone">Customer phone in +254 format</label>
                  <input
                    id="customerPhone"
                    name="customerPhone"
                    defaultValue={selectedCustomer?.phoneE164 ?? ''}
                    placeholder="+254711000101"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="staffId">Staff member</label>
                  <select id="staffId" name="staffId" defaultValue={selectedRecord.staffId}>
                    {visibleStaff.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="performedAt">Service date and time</label>
                  <input id="performedAt" name="performedAt" type="datetime-local" defaultValue={toDateTimeLocalValue(selectedRecord.performedAt)} />
                </div>
                <div className="field">
                  <label htmlFor="serviceMode">Service source</label>
                  <select id="serviceMode" name="serviceMode" defaultValue={selectedRecord.isCustomService ? 'custom' : 'price-list'}>
                    <option value="price-list">Use price list</option>
                    <option value="custom">Custom service</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="serviceId">Price list service</label>
                  <select id="serviceId" name="serviceId" defaultValue={selectedRecord.serviceId ?? services[0]?.id ?? ''}>
                    {services.length > 0 ? (
                      services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name} / {formatCurrency(service.price, tenant.currencyCode)}
                        </option>
                      ))
                    ) : (
                      <option value="">No services configured</option>
                    )}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="customServiceName">Custom service name</label>
                  <input
                    id="customServiceName"
                    name="customServiceName"
                    defaultValue={selectedRecord.isCustomService ? selectedRecord.serviceName ?? '' : ''}
                    placeholder="Home Service Beard Trim"
                  />
                </div>
                <div className="field">
                  <label htmlFor="customPrice">Custom price</label>
                  <input
                    id="customPrice"
                    name="customPrice"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={selectedRecord.isCustomService ? selectedRecord.price : ''}
                    placeholder="1000"
                  />
                </div>
                <div className="field">
                  <label htmlFor="productId">Used product</label>
                  <select id="productId" name="productId" defaultValue={firstUsage?.productId ?? ''}>
                    <option value="">No product recorded</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>
                        {product.name} / {formatCurrency(product.unitCost, tenant.currencyCode)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="productQuantity">Product quantity</label>
                  <input
                    id="productQuantity"
                    name="productQuantity"
                    type="number"
                    min="0"
                    step="1"
                    defaultValue={firstUsage?.quantity ?? 0}
                  />
                </div>
                <div className="field">
                  <label htmlFor="description">Service notes</label>
                  <textarea id="description" name="description" defaultValue={selectedRecord.description ?? ''} />
                </div>
                <div className="hero-actions">
                  <button type="submit" className="button">
                    Save correction
                  </button>
                  <Link href={`/app/receipts/${selectedRecord.id}`} className="button secondary">
                    Open printable receipt
                  </Link>
                </div>
              </form>
            </div>
          ) : (
            <p className="muted">Choose a sale from the list to edit it.</p>
          )}
        </section>
      </section>
    </>
  );
}
