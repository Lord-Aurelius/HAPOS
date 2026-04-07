import { AddCustomerForm } from '@/components/customers/add-customer-form';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { archiveCustomerAction, updateCustomerAction } from '@/server/actions/hapos';
import { requireSession } from '@/server/auth/demo-session';
import { listCustomers, listServiceRecords } from '@/server/services/app-data';

type CustomersPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function CustomersPage({ searchParams }: CustomersPageProps) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return null;
  }
  const params = await searchParams;

  const [customers, records] = await Promise.all([
    listCustomers(session.tenant.id),
    listServiceRecords(session.tenant.id),
  ]);

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Customer management</p>
        <h1 className="hero-title">Every visit stays attached to the phone number.</h1>
        <p className="hero-subtitle">
          Staff can pull up history quickly, while admins keep retention, value, and marketing consent visible in one place.
        </p>
      </section>

      {params.success ? (
        <section className="panel">
          <span className="pill">
            {params.success === 'customer-updated'
              ? 'Customer details saved.'
              : params.success === 'customer-archived'
                ? 'Customer archived from the active list.'
                : params.success === 'customer-restored'
                  ? 'Archived customer restored into the active list.'
                  : params.success === 'customer-added'
                    ? 'Customer added successfully.'
                : 'Customer change saved.'}
          </span>
        </section>
      ) : null}

      {params.error ? (
        <section className="panel">
          <span className="pill" style={{ background: 'rgba(160, 60, 46, 0.12)', color: 'var(--danger)' }}>
            {params.error === 'customer-required'
              ? 'Enter both the customer name and phone number.'
              : params.error === 'customer-exists'
                ? 'A customer with that phone number already exists in this shop.'
                : 'Customer change could not be saved.'}
          </span>
        </section>
      ) : null}

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Customer list</h2>
              <p className="panel-copy">Search by phone or name in the live app; each customer remains isolated to the current tenant.</p>
            </div>
          </div>

          {session.user.role !== 'staff' ? (
            <AddCustomerForm />
          ) : null}

          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Visits</th>
                <th>Lifetime value</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>{customer.name}</td>
                  <td>{customer.phoneE164}</td>
                  <td>{customer.totalVisits}</td>
                  <td>{formatCurrency(customer.lifetimeValue ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{session.user.role === 'staff' ? 'Visit history snapshot' : 'Customer maintenance'}</h2>
              <p className="panel-copy">
                {session.user.role === 'staff'
                  ? 'Recent service records help staff remember preferences before the next appointment or walk-in.'
                  : 'Admins can correct names, update phone numbers, and archive customer records without leaving the tenant workspace.'}
              </p>
            </div>
          </div>

          {session.user.role === 'staff' ? (
            <div className="stack">
              {records.map((record) => (
                <div className="list-row" key={record.id}>
                  <div>
                    <strong>{record.customerName}</strong>
                    <div className="eyebrow">
                      {record.serviceName} with {record.staffName}
                    </div>
                  </div>
                  <div className="eyebrow">{formatDateTime(record.performedAt)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="stack">
              {customers.map((customer) => (
                <form action={updateCustomerAction} key={customer.id} className="panel" style={{ padding: 18 }}>
                  <input type="hidden" name="customerId" value={customer.id} />
                  <input type="hidden" name="redirectTo" value="/app/customers?success=customer-updated" />
                  <div className="field-grid">
                    <div className="field">
                      <label>Name</label>
                      <input name="name" defaultValue={customer.name} />
                    </div>
                    <div className="field">
                      <label>Phone</label>
                      <input name="phone" defaultValue={customer.phone} />
                    </div>
                    <div className="field">
                      <label>Phone in +254 format</label>
                      <input name="phoneE164" defaultValue={customer.phoneE164} />
                    </div>
                    <div className="field">
                      <label>Notes</label>
                      <textarea name="notes" defaultValue={customer.notes ?? ''} />
                    </div>
                    <label className="eyebrow" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        name="marketingOptIn"
                        defaultChecked={customer.marketingOptIn}
                        style={{ width: 18, minHeight: 18 }}
                      />
                      Receive promotions
                    </label>
                    <div className="hero-actions" style={{ marginTop: 0 }}>
                      <button type="submit" className="button secondary">
                        Save customer
                      </button>
                    </div>
                  </div>
                  <div className="list-row" style={{ paddingBottom: 0 }}>
                    <div className="eyebrow">
                      {customer.totalVisits ?? 0} visits / {formatCurrency(customer.lifetimeValue ?? 0)}
                    </div>
                    <button
                      formAction={archiveCustomerAction}
                      name="redirectTo"
                      value="/app/customers?success=customer-archived"
                      className="button secondary"
                      style={{ minHeight: 40 }}
                    >
                      Archive
                    </button>
                  </div>
                </form>
              ))}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
