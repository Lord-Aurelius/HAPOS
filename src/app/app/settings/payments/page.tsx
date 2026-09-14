import {
  connectPaymentOSAction,
  disconnectConnectionAction,
  verifyConnectionAction,
} from '@/server/actions/payment-connections';
import { requireSession } from '@/server/auth/demo-session';
import { getCommerceRepository } from '@/server/commerce/repository-select';
import { getServerPaymentEnvironment } from '@/server/payments/payment-service';
import { getPaymentSettings } from '@/server/payments/connection-service';

type PaymentsSettingsPageProps = {
  searchParams: Promise<{ success?: string; error?: string; message?: string }>;
};

const SUCCESS_MESSAGES: Record<string, string> = {
  connected: 'PaymentOS connected. M-Pesa is live for this shop.',
  'connection-verified': 'Connection verified with PaymentOS.',
  disconnected: 'Payment connection disconnected. New M-Pesa payments are blocked; past payments are unchanged.',
};

const ERROR_MESSAGES: Record<string, string> = {
  'connection-verification-failed': 'PaymentOS rejected the connection details. Check the merchant id, API key and webhook secret.',
  'connection-environment-mismatch': 'The connection environment does not match this server environment.',
  'connection-secret-unavailable': 'Server secret storage is not configured. Contact the platform team.',
  'connection-not-found': 'No payment connection is configured yet.',
  CREDENTIALS_REJECTED: 'PaymentOS rejected the API key for this merchant id.',
  UNREACHABLE: 'PaymentOS did not respond. Try again shortly.',
  ENVIRONMENT_MISMATCH: 'The PaymentOS accounts are not in the selected environment.',
  NO_MPESA_ACCOUNT: 'No M-Pesa payment account exists on the PaymentOS merchant yet.',
  SECRET_UNAVAILABLE: 'Connection credentials cannot be opened. Reconnect the payment connection.',
};

function statusLabel(status: string | null | undefined) {
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

function formatDateTime(value: string | null | undefined) {
  return value ? value.slice(0, 16).replace('T', ' ') : 'never';
}

export default async function PaymentsSettingsPage({ searchParams }: PaymentsSettingsPageProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return null;
  }
  const params = await searchParams;
  const repo = getCommerceRepository();
  const settings = await getPaymentSettings(repo, { tenantId: session.tenant.id });
  const serverEnvironment = getServerPaymentEnvironment();
  const connection = settings.connection;
  const mpesa = Boolean(
    connection &&
      connection.status === 'CONNECTED' &&
      connection.supportedMethods.includes('MPESA'),
  );
  const banner = params.success
    ? { tone: 'ok' as const, text: SUCCESS_MESSAGES[params.success] ?? 'Saved.' }
    : params.error
      ? {
          tone: 'danger' as const,
          text: `${ERROR_MESSAGES[params.error] ?? 'Connection update failed.'}${params.message ? ` — ${params.message}` : ''}`,
        }
      : null;

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Payment settings</p>
        <h1 className="hero-title">How this shop accepts M-Pesa money.</h1>
        <p className="hero-subtitle">
          PaymentOS is the House Aurelius payment platform. Your shop&apos;s merchant account is created by the
          platform team; connect it here with the API key and webhook secret issued for your shop. Secrets are
          stored server-side and are never shown again after saving.
        </p>
      </section>

      {banner ? (
        <section className="panel">
          <span className="pill" style={banner.tone === 'danger' ? { background: 'rgba(160, 60, 46, 0.12)', color: 'var(--danger)' } : undefined}>
            {banner.text}
          </span>
        </section>
      ) : null}

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>PaymentOS</h2>
              <p className="panel-copy">Connection status and merchant identity.</p>
            </div>
          </div>
          <div className="stack">
            <div className="list-row">
              <div>
                <strong>{statusLabel(connection?.status)}</strong>
                <div className="eyebrow">
                  {connection?.providerTenantId
                    ? `Merchant: ${connection.displayName ?? connection.providerTenantId} · ${connection.providerTenantId}`
                    : 'No merchant connected yet.'}
                </div>
                {connection?.lastCheckCode ? (
                  <div className="eyebrow">Last check: {connection.lastCheckCode} — {connection.lastCheckMessage}</div>
                ) : null}
              </div>
            </div>
            <dl style={{ display: 'grid', gap: 6, margin: 0 }}>
              <div><dt className="eyebrow">Environment</dt><dd style={{ margin: 0 }}>{connection?.environment ?? serverEnvironment} (server: {serverEnvironment})</dd></div>
              <div><dt className="eyebrow">Supported methods</dt><dd style={{ margin: 0 }}>{connection?.supportedMethods?.length ? connection.supportedMethods.join(', ') : '—'}</dd></div>
              <div><dt className="eyebrow">Last verified</dt><dd style={{ margin: 0 }}>{formatDateTime(connection?.lastVerifiedAt)}</dd></div>
              <div>
                <dt className="eyebrow">M-Pesa</dt>
                <dd style={{ margin: 0 }}>{mpesa ? 'CONNECTED' : 'NOT CONNECTED'}</dd>
              </div>
            </dl>
            <div className="hero-actions">
              {connection?.status === 'CONNECTED' ? (
                <>
                  <form action={verifyConnectionAction}>
                    <button type="submit" className="button secondary">Test connection</button>
                  </form>
                  <form action={disconnectConnectionAction}>
                    <button type="submit" className="button secondary">Disconnect</button>
                  </form>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>{settings.hasEverConnected ? 'Reconnect PaymentOS' : 'Connect PaymentOS'}</h2>
              <p className="panel-copy">
                Paste the details the platform team issued for YOUR shop only. PaymentOS validates them before the
                connection is saved; use the same environment as this server ({serverEnvironment}).
              </p>
            </div>
          </div>
          <form action={connectPaymentOSAction} className="field-grid">
            <div className="field">
              <label htmlFor="providerTenantId">PaymentOS merchant id (tenant id)</label>
              <input id="providerTenantId" name="providerTenantId" required placeholder="e.g. salon-westlands" />
            </div>
            <div className="field">
              <label htmlFor="apiKey">API key (shown once by the platform)</label>
              <input id="apiKey" name="apiKey" type="password" required autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="webhookSecret">Webhook signing secret (shown once by the platform)</label>
              <input id="webhookSecret" name="webhookSecret" type="password" required autoComplete="off" />
            </div>
            <div className="field">
              <label htmlFor="environment">Environment</label>
              <select id="environment" name="environment" defaultValue={serverEnvironment}>
                <option value="SANDBOX">SANDBOX</option>
                <option value="PRODUCTION">PRODUCTION</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="displayName">Display name (optional)</label>
              <input id="displayName" name="displayName" placeholder="e.g. Westlands shop paybill" />
            </div>
            <div className="hero-actions">
              <button type="submit" className="button">Connect</button>
            </div>
          </form>
        </div>
      </section>
    </>
  );
}
