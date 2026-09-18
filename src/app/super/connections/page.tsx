import { AI_CONNECTION_ENDPOINTS } from '@/server/aegis/endpoints';
import { allCapabilities, capabilityCount } from '@/server/aegis/capabilities';
import { mintApiKeyAction, revokeApiKeyAction, listApiKeysForPortal } from '@/server/actions/ai-keys';
import { getPublicAppBaseUrl } from '@/server/config/public-url';
import { listTenants, listUsers } from '@/server/services/app-data';

type ConnectionsPageProps = {
  searchParams: Promise<{ success?: string; error?: string; showKey?: string; keyId?: string }>;
};

function getFeedbackMessage(params: { success?: string; error?: string }) {
  if (params.success === 'key-minted') return 'API key minted. Copy the secret now — it cannot be shown again.';
  if (params.success === 'key-revoked') return 'API key revoked. Existing connections using it stop working.';
  if (params.error === 'key-invalid') return 'That key request was invalid. Name it and bind a tenant and user.';
  if (params.error === 'key-forbidden') return 'Only the platform authority can create master keys.';
  if (params.error === 'key-missing') return 'That API key was not found.';
  return 'Connection update saved.';
}

function fullUrl(base: string, path: string) {
  return `${base}${path}`;
}

export default async function SuperConnectionsPage({ searchParams }: ConnectionsPageProps) {
  const params = await searchParams;
  const baseUrl = getPublicAppBaseUrl();
  const [keys, tenants] = await Promise.all([listApiKeysForPortal(), listTenants()]);
  const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));
  const usersByTenant = await Promise.all(tenants.map(async (tenant) => ({ tenantId: tenant.id, users: await listUsers(tenant.id) })));
  const userNameById = new Map<string, string>();
  for (const group of usersByTenant) {
    for (const user of group.users) {
      userNameById.set(user.id, `${user.fullName} (${user.role})`);
    }
  }
  const allUsers = usersByTenant.flatMap((group) =>
    group.users.map((user) => ({ ...user, tenantName: tenantById.get(group.tenantId)?.name ?? group.tenantId })),
  );

  const capabilities = allCapabilities();
  const counts = capabilityCount();
  const domains = new Map<string, { read: number; action: number }>();
  for (const capability of capabilities) {
    const entry = domains.get(capability.domain) ?? { read: 0, action: 0 };
    if (capability.type === 'read') {
      entry.read += 1;
    } else {
      entry.action += 1;
    }
    domains.set(capability.domain, entry);
  }

  const endpointRows: { label: string; method: string; url: string; note: string }[] = [
    { label: 'Connection advertisement', method: 'GET', url: fullUrl(baseUrl, AI_CONNECTION_ENDPOINTS.connection), note: 'Application, tenant/shop grounding, capabilities, schemas, event info.' },
    { label: 'Master shop grounding', method: 'POST', url: fullUrl(baseUrl, AI_CONNECTION_ENDPOINTS.shopGrounding), note: 'Master only. Validates shopId against the tenant registry.' },
    { label: 'Capability invocation', method: 'POST', url: fullUrl(baseUrl, AI_CONNECTION_ENDPOINTS.invoke), note: 'Grounded execution with confirmation gate and audit.' },
    { label: 'Event stream (SSE)', method: 'GET', url: fullUrl(baseUrl, AI_CONNECTION_ENDPOINTS.events), note: 'Replay-from-cursor plus live tail of shop state transitions.' },
    { label: 'Key listing', method: 'GET', url: fullUrl(baseUrl, AI_CONNECTION_ENDPOINTS.keys), note: 'Metadata only. Secrets are never returned.' },
    { label: 'Key minting', method: 'POST', url: fullUrl(baseUrl, AI_CONNECTION_ENDPOINTS.keys), note: 'Super admin session only. Secret returned once.' },
    { label: 'Key revocation', method: 'POST', url: fullUrl(baseUrl, AI_CONNECTION_ENDPOINTS.keysRevoke), note: 'Super admin session only.' },
    { label: 'Legacy tool surface', method: 'GET/POST', url: fullUrl(baseUrl, AI_CONNECTION_ENDPOINTS.tools), note: 'Same pipeline, legacy envelope.' },
  ];

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Super admin</p>
        <h1 className="hero-title">Connections.</h1>
        <p className="hero-subtitle">
          HAPOS AI/API connections for AEGIS: endpoints, capabilities, event stream, and API keys. Normal keys are
          tenant + user bound; master keys are platform authority created only here.
        </p>
      </section>

      {params.success || params.error ? (
        <section className="panel">
          <span className="pill">{getFeedbackMessage(params)}</span>
        </section>
      ) : null}

      {params.success === 'key-minted' && params.showKey ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Copy this secret now</h2>
              <p className="panel-copy">
                It is shown once and never stored. Authenticate with <code>Authorization: Bearer &lt;secret&gt;</code> or{' '}
                <code>x-api-key</code>.
              </p>
            </div>
          </div>
          <p className="panel-copy">
            <code>{params.showKey}</code>
          </p>
          {params.keyId ? <p className="eyebrow">Key ID: {params.keyId}</p> : null}
        </section>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Connection endpoints</h2>
            <p className="panel-copy">
              Base: <code>{baseUrl || '(relative — set PUBLIC_APP_URL for absolute QR and callback URLs)'}</code>. Session
              cookies authenticate browser calls; API keys authenticate AEGIS.
            </p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Capability</th>
              <th>Method</th>
              <th>Endpoint</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {endpointRows.map((row) => (
              <tr key={row.label}>
                <td><strong>{row.label}</strong></td>
                <td>{row.method}</td>
                <td><code>{row.url}</code></td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Advertised capabilities ({counts.total})</h2>
            <p className="panel-copy">
              {counts.read} reads, {counts.action} writes. A normal connection only ever advertises what its HAPOS user
              may execute; master connections additionally advertise platform capabilities after shop grounding.
            </p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Domain</th>
              <th>Reads</th>
              <th>Writes</th>
            </tr>
          </thead>
          <tbody>
            {[...domains.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([domain, entry]) => (
              <tr key={domain}>
                <td><strong>{domain}</strong></td>
                <td>{entry.read}</td>
                <td>{entry.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Capability schemas</h2>
            <p className="panel-copy">Required parameters are marked. Action capabilities additionally require confirm: true.</p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Capability</th>
              <th>Type</th>
              <th>Required parameters</th>
            </tr>
          </thead>
          <tbody>
            {capabilities.map((capability) => {
              const required = Object.entries(capability.params)
                .filter(([, param]) => param.required)
                .map(([name]) => name);
              return (
                <tr key={capability.id}>
                  <td>
                    <strong>{capability.id}</strong>
                    <div className="eyebrow">{capability.description}</div>
                  </td>
                  <td>{capability.type}</td>
                  <td>{required.length > 0 ? required.join(', ') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>API keys</h2>
            <p className="panel-copy">
              Only hashes are stored — secrets can never be read back. Normal keys stay pinned to their tenant on every
              call; master keys select a validated shop per operation.
            </p>
          </div>
        </div>

        <form action={mintApiKeyAction} className="field-grid" style={{ marginBottom: 24 }}>
          <input type="hidden" name="redirectTo" value="/super/connections" />
          <div className="field">
            <label htmlFor="key-name">Key name</label>
            <input id="key-name" name="name" placeholder="AEGIS production link" required />
          </div>
          <div className="field">
            <label htmlFor="key-scope">Scope</label>
            <select id="key-scope" name="scope" defaultValue="normal">
              <option value="normal">Normal (tenant + user bound)</option>
              <option value="master">Master (platform authority)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="key-tenant">Tenant (normal scope)</label>
            <select id="key-tenant" name="tenantId" defaultValue="">
              <option value="">—</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="key-user">User (normal scope)</label>
            <select id="key-user" name="userId" defaultValue="">
              <option value="">—</option>
              {allUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName} · {user.tenantName} ({user.role})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="key-expiry">Expires at (optional)</label>
            <input id="key-expiry" name="expiresAt" type="datetime-local" />
          </div>
          <div className="hero-actions">
            <button type="submit" className="button">
              Mint API key
            </button>
          </div>
        </form>

        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Bound tenant / user</th>
              <th>Status</th>
              <th>Created</th>
              <th>Last used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id}>
                <td>
                  <strong>{key.name}</strong>
                  <div className="eyebrow">{key.keyPrefix}…</div>
                </td>
                <td>{key.scope === 'master' ? 'master' : 'normal'}</td>
                <td>
                  {key.scope === 'master' ? (
                    'platform-wide'
                  ) : (
                    <>
                      <div>{tenantById.get(key.tenantId ?? '')?.name ?? key.tenantId ?? '—'}</div>
                      <div className="eyebrow">{(key.userId && userNameById.get(key.userId)) || key.userId || '—'}</div>
                    </>
                  )}
                </td>
                <td>
                  {key.status}
                  {key.expiresAt ? <div className="eyebrow">expires {key.expiresAt.slice(0, 16).replace('T', ' ')}</div> : null}
                </td>
                <td>{key.createdAt.slice(0, 16).replace('T', ' ')}</td>
                <td>{key.lastUsedAt ? key.lastUsedAt.slice(0, 16).replace('T', ' ') : 'never'}</td>
                <td>
                  {key.status === 'ACTIVE' ? (
                    <form action={revokeApiKeyAction}>
                      <input type="hidden" name="id" value={key.id} />
                      {key.scope === 'master' ? <input type="hidden" name="scope" value="master" /> : null}
                      <input type="hidden" name="redirectTo" value="/super/connections" />
                      <button type="submit" className="button secondary" style={{ minHeight: 38 }}>
                        Revoke
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
