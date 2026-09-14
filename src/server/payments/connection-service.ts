/**
 * Connection management service (Phase 4B) — the connect / verify /
 * disconnect / reconnect flows behind the admin payment settings.
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
 *
 * App-only module.
 */

import {
  PaymentConnectionError,
  connectionCheckFailure,
  getConnectionWrapKey,
  sealConnectionSecret,
  type ConnectPaymentOSInput,
  type OpsPaymentConnection,
  type PublicPaymentConnection,
  assertConnectInput,
  toPublicConnection,
} from './connection.ts';
import type { CommerceRepository } from '../commerce/repository.ts';
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
  | { outcome: 'connected'; connection: PublicPaymentConnection }
  | { outcome: 'error'; code: string; message: string };

/**
 * Connect (or reconnect) a tenant to a PaymentOS merchant.
 *
 * Same provider tenant id → the EXISTING connection row is updated and
 * reactivated (historical payments keep pointing at the same row).
 * Different provider tenant id → a NEW connection row is created (the old
 * row stays with its history); the one-active constraint guarantees only
 * one CONNECTED row per tenant+environment.
 */
export async function connectPaymentOS(
  repo: CommerceRepository,
  input: { tenantId: string; raw: unknown; actorId: string },
  env: Record<string, string | undefined> = process.env,
): Promise<ConnectOutcome> {
  const parsed: ConnectPaymentOSInput = assertConnectInput(input.raw);
  const serverEnv = serverEnvironment(env);
  if (parsed.environment !== serverEnv) {
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
  if (!health.connected) {
    const failure = connectionCheckFailure(health.failure === 'unauthorized' ? 'unauthorized' : 'unreachable');
    return { outcome: 'error', code: 'connection-verification-failed', message: `${failure.message} (${failure.code})` };
  }
  if (!health.mpesaAccount) {
    const failure = connectionCheckFailure('no-mpesa-account');
    return { outcome: 'error', code: 'connection-verification-failed', message: failure.message };
  }
  const accountEnvironment = health.mpesaAccount.environment;
  if (accountEnvironment && accountEnvironment !== parsed.environment) {
    const failure = connectionCheckFailure('environment-mismatch');
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
    return { outcome: 'connected', connection: toPublicConnection(updated) };
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
  return { outcome: 'connected', connection: toPublicConnection(created) };
}

/**
 * Verify/test the tenant's active connection. Returns a non-sensitive
 * diagnostic; stores lastVerifiedAt + failure code/message on the row.
 */
export async function verifyConnection(
  repo: CommerceRepository,
  input: { tenantId: string },
  env: Record<string, string | undefined> = process.env,
): Promise<{ status: 'CONNECTED' | 'ERROR'; code: string | null; message: string; connection: PublicPaymentConnection | null }> {
  const connection = await repo.getActiveConnection(input.tenantId);
  if (!connection) {
    return { status: 'ERROR', code: 'connection-not-found', message: 'No payment connection is configured for this shop.', connection: null };
  }
  let gateway: PaymentOSAdapter;
  try {
    gateway = buildConnectionGateway(connection, env);
  } catch (error) {
    const message = error instanceof PaymentConnectionError ? 'Connection credentials cannot be opened. Reconnect payments.' : 'Connection test failed.';
    const updated = await repo.updateConnection({
      tenantId: input.tenantId,
      connectionId: connection.id,
      status: 'ERROR',
      lastCheckCode: 'SECRET_UNAVAILABLE',
      lastCheckMessage: message,
    });
    return { status: 'ERROR', code: 'SECRET_UNAVAILABLE', message, connection: toPublicConnection(updated) };
  }
  const health = await gateway.checkHealth({});
  const now = new Date().toISOString();
  if (health.connected) {
    const updated = await repo.updateConnection({
      tenantId: input.tenantId,
      connectionId: connection.id,
      status: 'CONNECTED',
      lastVerifiedAt: now,
      lastCheckCode: null,
      lastCheckMessage: null,
    });
    return { status: 'CONNECTED', code: null, message: 'PaymentOS accepted the connection credentials.', connection: toPublicConnection(updated) };
  }
  const failure = connectionCheckFailure(health.failure === 'unauthorized' ? 'unauthorized' : 'unreachable');
  const updated = await repo.updateConnection({
    tenantId: input.tenantId,
    connectionId: connection.id,
    status: 'ERROR',
    lastCheckCode: failure.code,
    lastCheckMessage: failure.message,
  });
  return { status: 'ERROR', code: failure.code, message: failure.message, connection: toPublicConnection(updated) };
}

/** Disconnect: blocks NEW M-Pesa payments; history is untouched. */
export async function disconnectConnection(
  repo: CommerceRepository,
  input: { tenantId: string },
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
  return toPublicConnection(updated);
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
