/**
 * Payment service (Phase 4B): M-Pesa initiation, provider callbacks, retries,
 * expiry sweeps and cash records — orchestrated over CommerceRepository.
 *
 * Phase 4B change: the gateway is no longer a single global PaymentOS
 * client. Every payment resolves
 *
 *   tenant → active PaymentConnection → PaymentOS tenant (merchant)
 *
 * and the gateway is constructed from that connection's sealed, server-side
 * secrets. No client input can choose the connection, merchant, or amount.
 *
 * Money rules enforced here (unchanged from Phase 4):
 * - amounts always come from the authoritative order total (never the browser),
 * - no DB transaction is ever held open across a PaymentOS call,
 * - SUCCESS arrives only from verified provider confirmation (or cash),
 * - amount mismatches become explicit FAILED exceptions, never silent sales,
 * - SUCCESS + stock failure becomes needs_recovery (durable, recoverable).
 *
 * App-only module (imports the gateway + repository selector).
 */

import {
  PaymentConnectionError,
  getConnectionWrapKey,
  openConnectionSecret,
  type OpsPaymentConnection,
} from './connection.ts';
import { PaymentError, assertConfirmationAmount, assertInitiationAmount, buildPaymentIdempotencyKey } from '../commerce/payments.ts';
import type { CommerceRepository, OpsPayment } from '../commerce/repository.ts';
import { GatewayError, type PaymentGateway } from './gateway.ts';
import { MockPaymentProvider } from './mock-provider.ts';
import { PaymentOSAdapter } from './paymentos.ts';

export type PaymentServiceError = PaymentError | GatewayError | PaymentConnectionError;

/** Server-side environment separation: connections must match this. */
export function getServerPaymentEnvironment(env: Record<string, string | undefined> = process.env): 'SANDBOX' | 'PRODUCTION' {
  const explicit = (env.PAYMENTOS_ENVIRONMENT ?? '').trim().toUpperCase();
  if (explicit === 'SANDBOX' || explicit === 'PRODUCTION') {
    return explicit;
  }
  const production = env.APP_ENV === 'production' || env.NODE_ENV === 'production';
  return production ? 'PRODUCTION' : 'SANDBOX';
}

/**
 * True when this deployment has explicit PaymentOS platform configuration
 * (base URL). In configured environments a tenant without a connection is a
 * hard payment-unavailable error — never a silent mock fallback.
 */
function platformConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean((env.PAYMENTOS_BASE_URL ?? '').trim());
}

/**
 * Build a gateway bound to one connection's sealed secrets. Secrets are
 * opened in-memory only; they never reach logs, responses, or the caller.
 */
export function buildConnectionGateway(
  connection: OpsPaymentConnection,
  env: Record<string, string | undefined> = process.env,
): PaymentOSAdapter {
  const baseUrl = (env.PAYMENTOS_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (!baseUrl) {
    throw new GatewayError('gateway-unconfigured', 'PaymentOS platform endpoint is not configured.');
  }
  const key = getConnectionWrapKey(env);
  const apiKey = openConnectionSecret(connection.secretSealed, key);
  const webhookSecret = openConnectionSecret(connection.webhookSecretSealed, key);
  if (!connection.providerTenantId) {
    throw new PaymentConnectionError('connection-not-connected', 'Payment connection has no merchant identity.');
  }
  const timeoutMs = Number(env.PAYMENTOS_TIMEOUT_MS ?? 15000);
  return new PaymentOSAdapter(
    {
      baseUrl,
      apiKey,
      tenantId: connection.providerTenantId,
      webhookSecret,
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 15000,
    },
  );
}

export type ConnectionResolution =
  | { kind: 'connection'; connection: OpsPaymentConnection; gateway: PaymentOSAdapter }
  | { kind: 'unconfigured-mock'; gateway: MockPaymentProvider };

/**
 * Resolve tenant → active PaymentConnection → gateway.
 *
 * - A CONNECTED connection in the server environment wins.
 * - A CONNECTED connection in the WRONG environment is a hard error (never
 *   silently routed).
 * - Without any connection, only a NON-configured environment falls back to
 *   the mock (local dev); a configured environment raises payment-unavailable.
 */
export async function resolveTenantGateway(
  repo: CommerceRepository,
  tenantId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<ConnectionResolution> {
  const serverEnvironment = getServerPaymentEnvironment(env);
  const connection = await repo.getActiveConnection(tenantId);
  if (connection) {
    if (connection.environment !== serverEnvironment) {
      throw new PaymentConnectionError(
        'connection-environment-mismatch',
        'The shop payment connection belongs to a different environment.',
      );
    }
    return { kind: 'connection', connection, gateway: buildConnectionGateway(connection, env) };
  }
  if (platformConfigured(env)) {
    throw new PaymentConnectionError('connection-not-connected', 'M-Pesa is not connected for this shop.');
  }
  return { kind: 'unconfigured-mock', gateway: new MockPaymentProvider(env) };
}

/** M-Pesa readiness for checkout/admin surfaces (no secrets in the result). */
export async function getMpesaAvailability(
  repo: CommerceRepository,
  tenantId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<{ available: boolean; reason: string | null; connectionId: string | null }> {
  const serverEnvironment = getServerPaymentEnvironment(env);
  const connection = await repo.getActiveConnection(tenantId);
  if (!connection) {
    return { available: platformConfigured(env) ? false : true, reason: platformConfigured(env) ? 'payment-not-connected' : null, connectionId: null };
  }
  if (connection.environment !== serverEnvironment) {
    return { available: false, reason: 'payment-environment-mismatch', connectionId: connection.id };
  }
  if (connection.status !== 'CONNECTED' || !connection.supportedMethods.includes('MPESA')) {
    return { available: false, reason: 'payment-not-connected', connectionId: connection.id };
  }
  return { available: true, reason: null, connectionId: connection.id };
}

export function getPaymentGateway(env: Record<string, string | undefined> = process.env): PaymentGateway {
  // Fallback gateway used ONLY for payments without a connection (local
  // dev, tests, and pre-4B rows). Real initiation resolves the tenant's
  // connection via resolveTenantGateway; a production environment refuses
  // the mock itself (MockPaymentProvider constructor throws), so M-Pesa
  // stays unavailable per-tenant until a real connection exists.
  return new MockPaymentProvider(env);
}

export function getCallbackBaseUrl(env: Record<string, string | undefined> = process.env): string | null {
  const explicit = (env.PAYMENTOS_CALLBACK_BASE_URL ?? '').trim().replace(/\/+$/, '');
  if (explicit) {
    return explicit;
  }
  const appUrl = (env.PUBLIC_APP_URL ?? '').trim().replace(/\/+$/, '');
  return appUrl || null;
}

export type InitiateMpesaInput = {
  tenantId: string;
  orderId: string;
  actorId: string;
  customerPhone?: string | null;
  idempotencyKey?: string | null;
  callbackBaseUrl?: string | null;
};

/**
 * Initiate an M-Pesa payment for a held order. Idempotent per key: a retried
 * tap returns the existing attempt WITHOUT a second STK request.
 */
export async function initiateMpesaPayment(
  repo: CommerceRepository,
  fallbackGateway: PaymentGateway,
  input: InitiateMpesaInput,
  ctx: { now?: string; env?: Record<string, string | undefined> } = {},
): Promise<{ payment: OpsPayment; duplicate: boolean; providerRequestId: string }> {
  const env = ctx.env ?? process.env;
  const found = await repo.getOrderWithItems(input.tenantId, input.orderId);
  if (!found) {
    throw new PaymentError('unknown-payment', 'Order not found for this shop.');
  }
  const { order } = found;
  if (order.status === 'COMPLETED' || order.status === 'CANCELLED' || order.status === 'REJECTED') {
    throw new PaymentError('invalid-transition', `Order is ${order.status} and cannot take payment.`);
  }
  if ((order.paymentMethod ?? 'CASH') !== 'MPESA') {
    throw new PaymentError('invalid-transition', 'That order is not an M-Pesa order.');
  }
  const phone = input.customerPhone ?? order.customerPhone ?? null;
  if (!phone) {
    throw new PaymentError('invalid-phone', 'An M-Pesa payment needs the customer phone number.');
  }

  // Resolve the tenant's payment connection BEFORE any gateway work.
  const resolution = await resolveTenantGateway(repo, input.tenantId, env);
  const gateway = resolution.kind === 'connection' ? resolution.gateway : fallbackGateway;
  const connection = resolution.kind === 'connection' ? resolution.connection : null;

  // PaymentOS charges integer KES base units: the chargeable amount is the
  // authoritative total rounded to whole KES (M-Pesa cannot charge cents).
  const amount = Math.round(assertInitiationAmount(order.total));
  if (amount <= 0) {
    throw new PaymentError('invalid-amount', 'Payment amount must be greater than zero.');
  }

  const existingAttempts = await repo.getPaymentsByOrder(input.tenantId, input.orderId);
  const pending = existingAttempts.find((payment) => payment.status === 'PENDING');
  if (pending && !input.idempotencyKey) {
    // Retry of an unsettled attempt reuses it (no duplicate STK).
    return { payment: pending, duplicate: true, providerRequestId: pending.providerRequestId ?? '' };
  }
  const attempt = existingAttempts.length + 1;
  const key = input.idempotencyKey ?? buildPaymentIdempotencyKey(input.orderId, attempt);

  const created = await repo.createPayment({
    tenantId: input.tenantId,
    orderId: input.orderId,
    provider: 'PAYMENTOS',
    method: 'MPESA',
    amount,
    currencyCode: order.currencyCode,
    customerPhone: phone,
    idempotencyKey: key,
    attemptNumber: attempt,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    connection: connection
      ? { connectionId: connection.id, providerMerchantId: connection.providerTenantId }
      : null,
    createdBy: input.actorId,
  });
  if (created.duplicate) {
    return { payment: created.payment, duplicate: true, providerRequestId: created.payment.providerRequestId ?? '' };
  }

  let providerRequestId = '';
  try {
    const initiated = await gateway.initiatePayment({
      amount,
      currency: order.currencyCode,
      customerPhone: phone,
      tenantId: connection?.providerTenantId ?? undefined,
      reference: key,
      idempotencyKey: key,
      callbackUrl: input.callbackBaseUrl ? `${input.callbackBaseUrl}/api/v1/payments/callback?pid=${created.payment.id}` : null,
      description: `HAPOS order ${input.orderId}`,
      metadata: { tenant_id: input.tenantId, order_id: input.orderId },
    });
    providerRequestId = initiated.providerRequestId;
    await repo.updatePaymentProviderDetails({
      tenantId: input.tenantId,
      paymentId: created.payment.id,
      providerRequestId: initiated.providerRequestId,
      providerReference: initiated.providerReference,
      expiresAt: initiated.expiresAt,
    });
  } catch (error) {
    const failureCode =
      error instanceof GatewayError && error.code === 'gateway-timeout'
        ? 'PROVIDER_TIMEOUT'
        : error instanceof GatewayError && error.code === 'gateway-rejected'
          ? 'PROVIDER_REJECTED'
          : 'PROVIDER_ERROR';
    await repo.transitionPayment({
      tenantId: input.tenantId,
      paymentId: created.payment.id,
      to: 'FAILED',
      failureCode,
      failureReason: error instanceof Error ? error.message : 'Payment initiation failed.',
    });
    if (error instanceof GatewayError && error.code === 'gateway-unconfigured') {
      throw error;
    }
    const failed = await repo.getPaymentByIdempotency(input.tenantId, key);
    if (!failed) {
      throw error;
    }
    return { payment: failed, duplicate: false, providerRequestId };
  }

  const payment = await repo.getPaymentByIdempotency(input.tenantId, key);
  if (!payment) {
    throw new PaymentError('unknown-payment', 'Payment intent vanished after initiation.');
  }
  void ctx;
  return { payment, duplicate: false, providerRequestId };
}

export type CallbackOutcome =
  | { outcome: 'completed'; orderId: string; saleId: string }
  | { outcome: 'failed-held'; orderId: string }
  | { outcome: 'duplicate' }
  | { outcome: 'pending' };

/**
 * Handle a verified provider callback.
 *
 * Association order (never trusts a body-supplied tenant):
 *   rawBody → locate the HAPOS payment row (by ?pid= or provider request id)
 *   → load THAT payment's connection → verify the webhook signature with the
 *   connection's secret → only then act, scoped to the stored row's tenant.
 */
export async function handlePaymentCallback(
  repo: CommerceRepository,
  fallbackGateway: PaymentGateway,
  input: { rawBody: string; headers: Record<string, string | undefined>; paymentId?: string | null; env?: Record<string, string | undefined> },
): Promise<CallbackOutcome & { paymentId: string }> {
  const env = input.env ?? process.env;
  const located = await locateCallbackPayment(repo, input.paymentId ?? null, input.rawBody);
  if (!located) {
    throw new PaymentError('unknown-payment', 'Callback references an unknown payment.');
  }

  // Build the verifier from the payment's own connection when it has one;
  // connection-less (mock/legacy) payments keep using the fallback gateway.
  const gateway = await gatewayForCallback(repo, located, fallbackGateway, env);
  const event = gateway.parseCallback(input.rawBody, input.headers);

  // From here everything is tenant-scoped to the stored payment row.
  const tenantId = located.tenantId;
  const verified = await repo.getPaymentByIdempotency(tenantId, located.idempotencyKey ?? '');
  const current = verified && verified.id === located.id ? verified : located;

  if (current.status !== 'PENDING') {
    return { outcome: 'duplicate', paymentId: current.id };
  }

  if (event.status === 'SUCCESS') {
    const orderId = current.orderId;
    if (!orderId) {
      throw new PaymentError('unknown-payment', 'Successful payment has no order to finalize.');
    }
    const found = await repo.getOrderWithItems(tenantId, orderId);
    if (!found) {
      throw new PaymentError('unknown-payment', 'Order for this payment is missing.');
    }
    try {
      assertConfirmationAmount({
        authoritativeTotal: Math.round(found.order.total),
        reportedTotal: event.amount,
        currency: found.order.currencyCode,
        reportedCurrency: event.currency,
      });
    } catch {
      await repo.transitionPayment({
        tenantId,
        paymentId: current.id,
        to: 'FAILED',
        providerReference: event.providerReference,
        failureCode: 'AMOUNT_MISMATCH',
        failureReason: 'Provider amount differs from the HAPOS order total. Held for review.',
      });
      return { outcome: 'failed-held', paymentId: current.id, orderId };
    }
    const transitioned = await repo.transitionPayment({
      tenantId,
      paymentId: current.id,
      to: 'SUCCESS',
      providerReference: event.providerReference,
    });
    if (transitioned.duplicate) {
      return { outcome: 'duplicate', paymentId: current.id };
    }
    const completed = await repo.completePaidOrder({
      tenantId,
      orderId,
      paymentId: current.id,
      actorId: 'system',
    });
    if (completed.outcome === 'needs-recovery') {
      return { outcome: 'failed-held', paymentId: current.id, orderId };
    }
    return { outcome: 'completed', paymentId: current.id, orderId, saleId: completed.sale.id };
  }

  if (event.status === 'FAILED' || event.status === 'EXPIRED' || event.status === 'CANCELLED') {
    await repo.transitionPayment({
      tenantId,
      paymentId: current.id,
      to: event.status,
      providerReference: event.providerReference,
      failureCode: event.failureCode,
      failureReason: event.failureReason,
    });
    const orderId = current.orderId;
    return orderId ? { outcome: 'failed-held', paymentId: current.id, orderId } : { outcome: 'duplicate', paymentId: current.id };
  }

  return { outcome: 'pending', paymentId: current.id };
}

/** Correlate a callback to a payment row WITHOUT trusting the body. */
async function locateCallbackPayment(repo: CommerceRepository, paymentId: string | null, rawBody: string): Promise<OpsPayment | null> {
  if (paymentId) {
    const byPid = await repo.getPaymentByIdGlobal(paymentId);
    if (byPid) {
      return byPid;
    }
  }
  // Untrusted, read-only peek at the raw payload for the provider payment
  // id — used only to find a candidate row; nothing is acted on until the
  // connection-bound signature verification succeeds.
  try {
    const parsed = JSON.parse(rawBody) as { paymentId?: unknown; request_id?: unknown };
    const providerRequestId = typeof parsed.paymentId === 'string' ? parsed.paymentId : typeof parsed.request_id === 'string' ? parsed.request_id : null;
    if (providerRequestId) {
      return repo.getPaymentByProviderRequestGlobal(providerRequestId);
    }
  } catch {
    // Malformed JSON surfaces as gateway-malformed from parseCallback later.
  }
  return null;
}

async function gatewayForCallback(
  repo: CommerceRepository,
  payment: OpsPayment,
  fallbackGateway: PaymentGateway,
  env: Record<string, string | undefined>,
): Promise<PaymentGateway> {
  if (!payment.connection?.connectionId) {
    return fallbackGateway;
  }
  const connection = await repo.getConnectionById(payment.tenantId, payment.connection.connectionId);
  if (!connection || connection.status !== 'CONNECTED') {
    // Disconnected/replaced merchant: historical payments still verify via
    // the connection row's stored secret even after disconnection (the row
    // and its secrets are retained, status only gates NEW initiations).
    if (!connection) {
      throw new PaymentConnectionError('connection-not-found', 'Payment connection for this payment no longer exists.');
    }
  }
  return buildConnectionGateway(connection, env);
}

export type RetryMpesaInput = {
  tenantId: string;
  orderId: string;
  actorId: string;
  customerPhone?: string | null;
  callbackBaseUrl?: string | null;
};

/** New attempt on the same order (history preserved; unsettled PENDING reused). */
export async function retryMpesaPayment(
  repo: CommerceRepository,
  fallbackGateway: PaymentGateway,
  input: RetryMpesaInput,
  ctx: { env?: Record<string, string | undefined> } = {},
) {
  const found = await repo.getOrderWithItems(input.tenantId, input.orderId);
  if (!found) {
    throw new PaymentError('unknown-payment', 'Order not found for this shop.');
  }
  if (found.order.status === 'COMPLETED') {
    throw new PaymentError('invalid-transition', 'That order is already completed.');
  }
  return initiateMpesaPayment(repo, fallbackGateway, {
    tenantId: input.tenantId,
    orderId: input.orderId,
    actorId: input.actorId,
    customerPhone: input.customerPhone ?? found.order.customerPhone ?? null,
    callbackBaseUrl: input.callbackBaseUrl ?? null,
  }, ctx);
}

/** Sweep overdue PENDING intents to EXPIRED. Returns the transitioned count. */
export async function expireOverduePayments(
  repo: CommerceRepository,
  input: { tenantId?: string; tenants?: string[]; now?: string },
): Promise<number> {
  const now = input.now ?? new Date().toISOString();
  const tenants = input.tenants ?? (input.tenantId ? [input.tenantId] : []);
  let expired = 0;
  for (const tenantId of tenants) {
    const pending = await repo.listPayments(tenantId, { status: 'PENDING' });
    for (const payment of pending) {
      if (payment.expiresAt && Date.parse(payment.expiresAt) <= Date.parse(now)) {
        await repo.transitionPayment({ tenantId, paymentId: payment.id, to: 'EXPIRED', failureCode: 'TIMEOUT', failureReason: 'Payment prompt expired.' });
        expired += 1;
      }
    }
  }
  return expired;
}

/** Cash completion record: uniform payment model for later reconciliation. */
export async function recordCashPayment(
  repo: CommerceRepository,
  input: { tenantId: string; orderId: string; saleId: string; amount: number; currencyCode: string; actorId: string },
) {
  const created = await repo.createPayment({
    tenantId: input.tenantId,
    orderId: input.orderId,
    saleId: input.saleId,
    provider: 'INTERNAL',
    method: 'CASH',
    amount: input.amount,
    currencyCode: input.currencyCode,
    idempotencyKey: `cash-${input.saleId}`,
    attemptNumber: 1,
    createdBy: input.actorId,
  });
  if (!created.duplicate) {
    await repo.transitionPayment({ tenantId: input.tenantId, paymentId: created.payment.id, to: 'SUCCESS' });
  }
  return created.payment;
}
