import { requireSession } from '@/server/auth/demo-session';
import { getCommerceRepository } from '@/server/commerce/repository-select';
import { listConnectionsForAudit } from '@/server/payments/connection-service';
import { listTenants } from '@/server/services/app-data';

function formatDateTime(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace('T', ' ') : 'never';
}

/**
 * Super-admin payment connection audit (Phase 4B closure).
 *
 * READ-ONLY platform support surface: which HAPOS tenant is connected to
 * which PaymentOS merchant. Shows non-secret metadata only — provider
 * references are masked and no sealed or plaintext credential material is
 * ever requested, rendered, or retrievable from this page.
 */

const STATUS_TONE: Record<string, string> = {
  CONNECTED: 'var(--ok, #2e7d32)',
  ERROR: 'var(--danger, #a03c2e)',
  DISCONNECTED: 'var(--muted, #666)',
  CONNECTING: 'var(--muted, #666)',
  NOT_CONNECTED: 'var(--muted, #666)',
};

function statusLabel(status: string) {
  switch (status) {
    case 'CONNECTED':
      return 'Connected';
    case 'ERROR':
      return 'Error';
    case 'CONNECTING':
      return 'Connecting';
    case 'DISCONNECTED':
      return 'Disconnected';
    default:
      return 'Not connected';
  }
}

function eventLabel(action: string) {
  switch (action) {
    case 'CONNECTED':
      return 'Connected';
    case 'RECONNECTED':
      return 'Reconnected';
    case 'VERIFIED':
      return 'Verified';
    case 'DISCONNECTED':
      return 'Disconnected';
    case 'CREDENTIAL_ROTATED':
      return 'Credentials rotated';
    case 'ROTATION_FAILED':
      return 'Rotation failed';
    case 'ENVIRONMENT_REJECTED':
      return 'Environment rejected';
    case 'FOREIGN_MERCHANT_REJECTED':
      return 'Foreign merchant rejected';
    default:
      return action;
  }
}

export default async function SuperPaymentsAuditPage() {
  await requireSession(['super_admin']);
  const repo = getCommerceRepository();
  const [connections, tenants] = await Promise.all([listConnectionsForAudit(repo), listTenants()]);

  const tenantNameById = new Map(tenants.map((tenant) => [tenant.id, tenant.name] as const));
  const rows = connections
    .map((connection) => ({ connection, tenantName: tenantNameById.get(connection.tenantId) ?? connection.tenantId }))
    .sort((a, b) => a.tenantName.localeCompare(b.tenantName));

  // Recent lifecycle events per tenant (newest first), for the audit trail.
  const eventGroups = await Promise.all(
    tenants.map(async (tenant) => ({
      tenant,
      events: await repo.listConnectionEvents(tenant.id, { limit: 8 }),
    })),
  );
  const eventsWithTenants = eventGroups
    .filter((group) => group.events.length > 0)
    .sort((a, b) => (b.events[0]?.createdAt ?? '').localeCompare(a.events[0]?.createdAt ?? ''));

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Payments audit</p>
        <h1 className="hero-title">Who is connected to PaymentOS.</h1>
        <p className="hero-subtitle">
          Read-only platform view of every shop&apos;s payment connection. Merchant references are masked;
          API keys, webhook secrets and sealed credential material are never shown here — platform privileges
          do not grant access to shop payment secrets.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Payment connections ({rows.length})</h2>
            <p className="panel-copy">One row per connection identity, including disconnected history.</p>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="panel-copy">No tenant has connected a PaymentOS merchant yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Business</th>
                  <th>Provider</th>
                  <th>Merchant reference</th>
                  <th>Environment</th>
                  <th>Status</th>
                  <th>Connected</th>
                  <th>Last verified</th>
                  <th>Disconnected</th>
                  <th>Last check</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ connection, tenantName }) => (
                  <tr key={connection.id}>
                    <td>{tenantName}</td>
                    <td>{connection.displayName ?? '—'}</td>
                    <td>{connection.provider}</td>
                    <td>
                      {connection.providerTenantId ? <code>{connection.providerTenantId}</code> : '—'}
                    </td>
                    <td>{connection.environment}</td>
                    <td style={{ color: STATUS_TONE[connection.status], fontWeight: 600 }}>
                      {statusLabel(connection.status)}
                    </td>
                    <td>{formatDateTime(connection.connectedAt ?? null)}</td>
                    <td>{formatDateTime(connection.lastVerifiedAt ?? null)}</td>
                    <td>{formatDateTime(connection.disconnectedAt ?? null)}</td>
                    <td>
                      {connection.lastCheckCode
                        ? `${connection.lastCheckCode} — ${connection.lastCheckMessage ?? ''}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Connection audit trail</h2>
            <p className="panel-copy">
              Lifecycle events per shop (newest first). Actions and outcomes only — no credential material is
              ever recorded.
            </p>
          </div>
        </div>
        {eventsWithTenants.length === 0 ? (
          <p className="panel-copy">No connection events recorded yet.</p>
        ) : (
          eventsWithTenants.map(({ tenant, events }) => (
            <div key={tenant.id} style={{ marginBottom: 16 }}>
              <h3 style={{ margin: '0 0 6px' }}>{tenant.name}</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {events.map((event) => (
                  <li key={event.id}>
                    <strong>{eventLabel(event.action)}</strong>
                    {event.result === 'ERROR' ? ' — failed' : ''}
                    {event.oldProviderReference ? ` · from ${event.oldProviderReference}` : ''}
                    {event.newProviderReference ? ` · to ${event.newProviderReference}` : ''}
                    {event.actorId ? ` · by ${event.actorId}` : ''}
                    {` · ${formatDateTime(event.createdAt)}`}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}
