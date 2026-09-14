/**
 * Connection management service (Phase 4B + closure) — the connect / verify /
 * disconnect / reconnect / rotate flows behind the admin payment settings.
 *
 * Security properties:
 * - The caller's tenant comes from the authenticated session, never input.
 * - Provider secrets are sealed immediately and never returned, logged or
 *   echoed back to the browser.
 * - Connection status becomes CONNECTED only after a live health check
 *   against PaymentOS succeeds (verified contract: authenticated
 *   GET /api/payment-accounts must return the tenant's accounts).
 * - Environment separation: the connection's environment must match the
 *   server environment (PAYMENTOS_ENVIRONMENT / APP_ENV), so a staging
 *   tenant can never attach a production merchant by accident.
 * - Every lifecycle action appends a non-secret audit event
 *   (payment_connection_events): tenant, actor, action, result, references.
 *
 * Credential rotation (closure): PaymentOS shows a tenant API key once and
 * supports regeneration from the admin console; there is no dual-key
 * overlap window in the verified contract, so rotation is an
 * application-side atomic cutover — the NEW credential is probed against
 * PaymentOS first and only replaces the sealed secret after verification
 * succeeds. Historical payments keep their stored references untouched.
 *
 * App-only module.
 */

import {
  PaymentConnectionError,
  connectionCheckFailure,
  getConnectionWrapKey,
  openConnectionSecret,
  sealConnectionSecret,
  type ConnectPaymentOSInput,
  type OpsPaymentConnection,
  type PublicPaymentConnection,
  assertConnectInput,
  toPublicConnection,
} from './connection.ts';
import type { CommerceRepository, OpsPaymentConnectionEvent } from '../commerce/repository.ts';
import { buildConnectionGateway } from './payment-service.ts';
import { PaymentOSAdapter } from './paymentos.ts';

function serverEnvironment(env: Record<string, string | undefined>): 'SANDBOX' | 'PRODUCTION' {
  const explicit = (env.PAYMENTOS_ENVIRONMENT ?? '').trim().toUpperCase();
  if (explicit === 'SANDBOX' || explicit === 'PRODUCTION') {
    return explicit;
  }
  const production = env.APP_ENV === 'production' || env.NODE_ENV === 'production';
  return production ? 'PRODUCTION' : 'SANDBOX';
}

export type ConnectOutcome =
  | { outcome: 'connected'; connection: PublicPaymentConnection; reconnected: boolean }
  | { outcome: 'error'; code: string; message: string };

/**
 * Health-check classification for the verify action. Distinguishes failure
 * causes instead of collapsing them into one message; stored diagnostics
 * are fixed-vocabulary codes, never provider payloads.
 */
export type ConnectionHealthStatus =
  | 'CONNECTED'
  | 'AUTHENTICATION_FAILED'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_MERCHANT'
  | 'UNSUPPORTED'
  | 'UNKNOWN';

export type VerifyOutcome = {
  status: ConnectionHealthStatus;
  code: string | null;
  message: string;
  connection: PublicPaymentConnection | null;
};

function classifyHealth(
  health: { connected: boolean; mpesaAccount: { id: string } | null; failure: 'unauthorized' | 'unreachable' | null },
  hasConnection: boolean,
): { status: ConnectionHealthStatus; code: string; message: string } {
  if (health.connected && health.mpesaAccount) {
    return { status: 'CONNECTED', code: null as unknown as string, message: 'PaymentOS accepted the connection credentials.' };
  }
  if (health.connected && !health.mpesaAccount) {
    const failure = connectionCheckFailure('no-mpesa-account');
    return { status: 'UNSUPPORTED', code: failure.code, message: failure.message };
  }
  if (health.failure === 'unauthorized') {
    // 401/403 from PaymentOS: either the key is wrong/revoked or the tenant
    // id does not match the key. Both read as authentication failure; the
    // INVALID_MERCHANT nuance requires provider-side disambiguation that the
    // verified contract does not expose.
    const failure = connectionCheckFailure('unauthorized');
    return { status: 'AUTHENTICATION_FAILED', code: failure.code, message: failure.message };
  }
  if (!hasConnection) {
    return { status: 'INVALID_MERCHANT', code: 'NO_CONNECTION', message: 'No payment connection is configured for this shop.' };
  }
  const failure = connectionCheckFailure('unreachable');
  return { status: 'PROVIDER_UNAVAILABLE', code: failure.code, message: failure.message };
}

/** Append a lifecycle audit event. Best-effort: never blocks the operation. */
async function audit(
  repo: CommerceRepository,
  input: {
    tenantId: string;
    connectionId?: string | null;
    action: OpsPaymentConnectionEvent['action'];
    actorId?: string | null;
    actorRole?: string | null;
    result?: 'OK' | 'ERROR';
    oldProviderReference?: string | null;
    newProviderReference?: string | null;
  },
): Promise<void> {
  try {
    await repo.recordConnectionEvent(input);
  } catch {
    // Audit is best-effort by design (mirrors PaymentOS safeAudit).
  }
}

/**
 * Connect (or reconnect) a tenant to a PaymentOS merchant.
 *
 * Same provider tenant id → the EXISTING connection row is updated and
 * reactivated (historical payments keep pointing at the same row) and the
 * action audits as RECONNECTED. Different provider tenant id → a NEW
 * connection row is created (the old row stays with its history) and the
 * action audits as CONNECTED; the one-active constraint guarantees only
 * one CONNECTED row per tenant+environment.
 */
export async function connectPaymentOS(
  repo: CommerceRepository,
  input: { tenantId: string; raw: unknown; actorId: string; actorRole?: string | null },
  env: Record<string, string | undefined> = process.env,
): Promise<ConnectOutcome> {
  const parsed: ConnectPaymentOSInput = assertConnectInput(input.raw);
  const serverEnv = serverEnvironment(env);
  if (parsed.environment !== serverEnv) {
    await audit(repo, {
      tenantId: input.tenantId,
      action: 'ENVIRONMENT_REJECTED',
      actorId: input.actorId,
      actorRole: input.actorRole ?? null,
      result: 'ERROR',
      newProviderReference: parsed.providerTenantId,
    });
    return {
      outcome: 'error',
      code: 'connection-environment-mismatch',
      message: `PaymentOS accounts live in ${parsed.environment} but this server runs ${serverEnv}. Choose the matching environment.`,
    };
  }
  const wrapKey = getConnectionWrapKey(env);
  if (!wrapKey) {
    return {
      outcome: 'error',
      code: 'connection-secret-unavailable',
      message: 'Server secret store is not configured (PAYMENTOS_WRAP_KEY). Contact the platform team.',
    };
  }

  // Probe the credentials BEFORE persisting anything sensitive.
  const probe = new PaymentOSAdapter({
    baseUrl: (env.PAYMENTOS_BASE_URL ?? '').trim().replace(/\/+$/, ''),
    apiKey: parsed.apiKey,
    tenantId: parsed.providerTenantId,
    webhookSecret: parsed.webhookSecret,
    timeoutMs: Number(env.PAYMENTOS_TIMEOUT_MS ?? 15000) || 15000,
  });
  const health = await probe.checkHealth({});
  if (!health.connected || !health.mpesaAccount) {
    const verdict = classifyHealth(health, true);
    await audit(repo, {
      tenantId: input.tenantId,
      action: health.failure === 'unauthorized' ? 'FOREIGN_MERCHANT_REJECTED' : 'CONNECTED',
      actorId: input.actorId,
      actorRole: input.actorRole ?? null,
      result: 'ERROR',
      newProviderReference: parsed.providerTenantId,
    });
    void verdict;
    return { outcome: 'error', code: 'connection-verification-failed', message: verdict.message };
  }
  const accountEnvironment = health.mpesaAccount.environment;
  if (accountEnvironment && accountEnvironment !== parsed.environment) {
    const failure = connectionCheckFailure('environment-mismatch');
    await audit(repo, {
      tenantId: input.tenantId,
      action: 'ENVIRONMENT_REJECTED',
      actorId: input.actorId,
      actorRole: input.actorRole ?? null,
      result: 'ERROR',
      newProviderReference: parsed.providerTenantId,
    });
    return { outcome: 'error', code: 'connection-environment-mismatch', message: failure.message };
  }

  const now = new Date().toISOString();
  const secretSealed = sealConnectionSecret(parsed.apiKey, wrapKey);
  const webhookSecretSealed = sealConnectionSecret(parsed.webhookSecret, wrapKey);
  const supportedMethods = ['MPESA'] as const;

  const existing = await repo.findConnectionByProviderTenantId(parsed.providerTenantId);
  if (existing && existing.tenantId !== input.tenantId) {
    // Ownership violation reads as verification failure: never leak that the
    // merchant id exists elsewhere.
    await audit(repo, {
      tenantId: input.tenantId,
      action: 'FOREIGN_MERCHANT_REJECTED',
      actorId: input.actorId,
      actorRole: input.actorRole ?? null,
      result: 'ERROR',
      newProviderReference: parsed.providerTenantId,
    });
    return {
      outcome: 'error',
      code: 'connection-verification-failed',
      message: 'PaymentOS rejected this merchant for your shop. Confirm the merchant id with the platform team.',
    };
  }

  if (existing && existing.tenantId === input.tenantId) {
    // Reconnect to the SAME merchant: update secrets + reactivate.
    const updated = await repo.updateConnection({
      tenantId: input.tenantId,
      connectionId: existing.id,
      status: 'CONNECTED',
      secretSealed,
      webhookSecretSealed,
      connectedAt: existing.connectedAt ?? now,
      lastVerifiedAt: now,
      disconnectedAt: null,
      lastCheckCode: null,
      lastCheckMessage: null,
      supportedMethods: [...supportedMethods],
      displayName: parsed.displayName ?? existing.displayName,
    });
    await audit(repo, {
      tenantId: input.tenantId,
      connectionId: existing.id,
      action: 'RECONNECTED',
      actorId: input.actorId,
      actorRole: input.actorRole ?? null,
      newProviderReference: parsed.providerTenantId,
    });
    return { outcome: 'connected', connection: toPublicConnection(updated), reconnected: true };
  }

  const created = await repo.createConnection({
    tenantId: input.tenantId,
    provider: 'PAYMENTOS',
    providerTenantId: parsed.providerTenantId,
    environment: parsed.environment,
    status: 'CONNECTED',
    displayName: parsed.displayName ?? health.mpesaAccount.displayName ?? null,
    supportedMethods: [...supportedMethods],
    secretSealed,
    webhookSecretSealed,
    connectedAt: now,
    lastVerifiedAt: now,
  });
  await audit(repo, {
    tenantId: input.tenantId,
    connectionId: created.id,
    action: 'CONNECTED',
    actorId: input.actorId,
    actorRole: input.actorRole ?? null,
    newProviderReference: parsed.providerTenantId,
  });
  return { outcome: 'connected', connection: toPublicConnection(created), reconnected: false };
}

/**
 * Verify/test the tenant's active connection. Returns a classified,
 * non-sensitive diagnostic; stores lastVerifiedAt + failure code/message on
 * the row and audits VERIFIED (OK or ERROR).
 */
export async function verifyConnection(
  repo: CommerceRepository,
  input: { tenantId: string; actorId?: string | null; actorRole?: string | null },
  env: Record<string, string | undefined> = process.env,
): Promise<VerifyOutcome> {
  const connection = await repo.getActiveConnection(input.tenantId);
  if (!connection) {
    return { status: 'INVALID_MERCHANT', code: 'NO_CONNECTION', message: 'No payment connection is configured for this shop.', connection: null };
  }
  let gateway: PaymentOSAdapter;
  try {
    gateway = buildConnectionGateway(connection, env);
  } catch {
    const updated = await repo.updateConnection({
      tenantId: input.tenantId,
      connectionId: connection.id,
      status: 'ERROR',
      lastCheckCode: 'SECRET_UNAVAILABLE',
      lastCheckMessage: 'Connection credentials cannot be opened. Reconnect payments.',
    });
    await audit(repo, {
      tenantId: input.tenantId,
      connectionId: connection.id,
      action: 'VERIFIED',
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      result: 'ERROR',
    });
    return {
      status: 'UNKNOWN',
      code: 'SECRET_UNAVAILABLE',
      message: 'Connection credentials cannot be opened. Reconnect payments.',
      connection: toPublicConnection(updated),
    };
  }
  const health = await gateway.checkHealth({});
  const verdict = classifyHealth(health, true);
  const now = new Date().toISOString();
  if (verdict.status === 'CONNECTED') {
    const updated = await repo.updateConnection({
      tenantId: input.tenantId,
      connectionId: connection.id,
      status: 'CONNECTED',
      lastVerifiedAt: now,
      lastCheckCode: null,
      lastCheckMessage: null,
    });
    await audit(repo, {
      tenantId: input.tenantId,
      connectionId: connection.id,
      action: 'VERIFIED',
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
    });
    return { status: 'CONNECTED', code: null, message: verdict.message, connection: toPublicConnection(updated) };
  }
  const updated = await repo.updateConnection({
    tenantId: input.tenantId,
    connectionId: connection.id,
    status: 'ERROR',
    lastCheckCode: verdict.code,
    lastCheckMessage: verdict.message,
  });
  await audit(repo, {
    tenantId: input.tenantId,
    connectionId: connection.id,
    action: 'VERIFIED',
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
    result: 'ERROR',
  });
  return { status: verdict.status, code: verdict.code, message: verdict.message, connection: toPublicConnection(updated) };
}

/** Disconnect: blocks NEW M-Pesa payments; history is untouched. */
export async function disconnectConnection(
  repo: CommerceRepository,
  input: { tenantId: string; actorId?: string | null; actorRole?: string | null },
  env: Record<string, string | undefined> = process.env,
): Promise<PublicPaymentConnection | null> {
  void env;
  const connection = await repo.getActiveConnection(input.tenantId);
  if (!connection) {
    return null;
  }
  const updated = await repo.updateConnection({
    tenantId: input.tenantId,
    connectionId: connection.id,
    status: 'DISCONNECTED',
    disconnectedAt: new Date().toISOString(),
  });
  await audit(repo, {
    tenantId: input.tenantId,
    connectionId: connection.id,
    action: 'DISCONNECTED',
    actorId: input.actorId ?? null,
    actorRole: input.actorRole ?? null,
  });
  return toPublicConnection(updated);
}

export type RotateOutcome =
  | { outcome: 'rotated'; connection: PublicPaymentConnection }
  | { outcome: 'unchanged'; connection: PublicPaymentConnection; message: string }
  | { outcome: 'error'; code: string; message: string };

/**
 * Rotate the tenant's provider credentials (closure).
 *
 * PaymentOS displays API keys once and supports regeneration; the verified
 * contract has NO dual-key overlap, so rotation is an atomic cutover:
 *
 *   new credentials probed against PaymentOS
 *     → only on success are the sealed secrets replaced
 *     → audit CREDENTIAL_ROTATED (or ROTATION_FAILED)
 *
 * The old credential is retired implicitly (PaymentOS invalidates the
 * regenerated key) and is never used again for new calls because the
 * connection row's sealed secret is replaced in the same operation.
 * Historical payments are untouched: they reference the connection id and
 * their own provider references, never the credential.
 */
export async function rotateConnectionCredentials(
  repo: CommerceRepository,
  input: { tenantId: string; raw: unknown; actorId: string; actorRole?: string | null },
  env: Record<string, string | undefined> = process.env,
): Promise<RotateOutcome> {
  const connection = await repo.getActiveConnection(input.tenantId);
  if (!connection || !connection.providerTenantId) {
    return { outcome: 'error', code: 'connection-not-found', message: 'Connect a PaymentOS merchant before rotating credentials.' };
  }
  const parsed: ConnectPaymentOSInput = assertConnectInput(input.raw);
  if (parsed.providerTenantId !== connection.providerTenantId) {
    return {
      outcome: 'error',
      code: 'connection-verification-failed',
      message: 'Rotation must use the same PaymentOS merchant. To change merchants, disconnect and connect the new one.',
    };
  }
  const serverEnv = serverEnvironment(env);
  if (parsed.environment !== serverEnv || parsed.environment !== connection.environment) {
    return { outcome: 'error', code: 'connection-environment-mismatch', message: 'Rotation environment must match the active connection and this server.' };
  }
  const wrapKey = getConnectionWrapKey(env);
  if (!wrapKey) {
    return { outcome: 'error', code: 'connection-secret-unavailable', message: 'Server secret store is not configured (PAYMENTOS_WRAP_KEY).' };
  }

  // Verify BEFORE activating: probe the new credential pair.
  const probe = new PaymentOSAdapter({
    baseUrl: (env.PAYMENTOS_BASE_URL ?? '').trim().replace(/\/+$/, ''),
    apiKey: parsed.apiKey,
    tenantId: parsed.providerTenantId,
    webhookSecret: parsed.webhookSecret,
    timeoutMs: Number(env.PAYMENTOS_TIMEOUT_MS ?? 15000) || 15000,
  });
  const health = await probe.checkHealth({});
  if (!health.connected || !health.mpesaAccount) {
    const verdict = classifyHealth(health, true);
    await audit(repo, {
      tenantId: input.tenantId,
      connectionId: connection.id,
      action: 'ROTATION_FAILED',
      actorId: input.actorId,
      actorRole: input.actorRole ?? null,
      result: 'ERROR',
      oldProviderReference: connection.providerTenantId,
    });
    return { outcome: 'error', code: 'connection-verification-failed', message: `New credentials were rejected: ${verdict.message}` };
  }
  const accountEnvironment = health.mpesaAccount.environment;
  if (accountEnvironment && accountEnvironment !== connection.environment) {
    const failure = connectionCheckFailure('environment-mismatch');
    await audit(repo, {
      tenantId: input.tenantId,
      connectionId: connection.id,
      action: 'ROTATION_FAILED',
      actorId: input.actorId,
      actorRole: input.actorRole ?? null,
      result: 'ERROR',
      oldProviderReference: connection.providerTenantId,
    });
    return { outcome: 'error', code: 'connection-environment-mismatch', message: failure.message };
  }

  // Idempotence guard: if the submitted key matches the active one, treat as
  // a verification touch rather than a rotation (no pointless cutover).
  const currentKey = (() => {
    try {
      return openConnectionSecret(connection.secretSealed, wrapKey);
    } catch {
      return null;
    }
  })();
  if (currentKey === parsed.apiKey) {
    return { outcome: 'unchanged', connection: toPublicConnection(connection), message: 'Those credentials are already active. Nothing changed.' };
  }

  // Atomic application-side cutover: same row, new sealed secrets.
  const updated = await repo.updateConnection({
    tenantId: input.tenantId,
    connectionId: connection.id,
    status: 'CONNECTED',
    secretSealed: sealConnectionSecret(parsed.apiKey, wrapKey),
    webhookSecretSealed: sealConnectionSecret(parsed.webhookSecret, wrapKey),
    lastVerifiedAt: new Date().toISOString(),
    lastCheckCode: null,
    lastCheckMessage: null,
    connectedAt: connection.connectedAt ?? new Date().toISOString(),
    disconnectedAt: null,
  });
  await audit(repo, {
    tenantId: input.tenantId,
    connectionId: connection.id,
    action: 'CREDENTIAL_ROTATED',
    actorId: input.actorId,
    actorRole: input.actorRole ?? null,
    oldProviderReference: connection.providerTenantId,
    newProviderReference: connection.providerTenantId,
  });
  return { outcome: 'rotated', connection: toPublicConnection(updated) };
}

/** Platform audit view: every tenant's connections, metadata only. */
export async function listConnectionsForAudit(
  repo: CommerceRepository,
): Promise<Array<PublicPaymentConnection & { tenantName: string | null }>> {
  const connections: OpsPaymentConnection[] = await repo.listAllConnectionsForAudit();
  return connections.map((connection) => ({
    ...toPublicConnection(connection),
    // Masked merchant reference for the platform surface (full value stays
    // server-side; the last 4 characters disambiguate without exposing the
    // id a third party could use against PaymentOS).
    providerTenantId: maskProviderReference(connection.providerTenantId),
    tenantName: null,
  }));
}

function maskProviderReference(reference: string | null): string | null {
  if (!reference) {
    return null;
  }
  if (reference.length <= 4) {
    return '****';
  }
  return `****${reference.slice(-4)}`;
}

/** Admin settings view model (non-secret). */
export async function getPaymentSettings(
  repo: CommerceRepository,
  input: { tenantId: string },
): Promise<{
  connection: PublicPaymentConnection | null;
  mpesaAvailable: boolean;
  hasEverConnected: boolean;
}> {
  const connections: OpsPaymentConnection[] = await repo.listConnections(input.tenantId);
  const active = connections.find((c) => c.status === 'CONNECTED') ?? null;
  const publicActive = active ? toPublicConnection(active) : null;
  return {
    connection: publicActive ?? (connections.length ? toPublicConnection(connections[0]) : null),
    mpesaAvailable: Boolean(
      active && active.supportedMethods.includes('MPESA'),
    ),
    hasEverConnected: connections.some((c) => c.connectedAt !== null),
  };
}
