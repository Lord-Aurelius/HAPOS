/**
 * Payment service (Phase 4): M-Pesa initiation, provider callbacks, retries,
 * expiry sweeps and cash records — orchestrated over CommerceRepository.
 *
 * Money rules enforced here:
 * - amounts always come from the authoritative order total (never the browser),
 * - no DB transaction is ever held open across a PaymentOS call,
 * - SUCCESS arrives only from verified provider confirmation (or cash),
 * - amount mismatches become explicit FAILED exceptions, never silent sales,
 * - SUCCESS + stock failure becomes needs_recovery (durable, recoverable),
 * - SMS/notifications happen post-commit, outside these functions.
 *
 * App-only module (imports the gateway + repository selector).
 */

import { PaymentError, assertConfirmationAmount, assertInitiationAmount, buildPaymentIdempotencyKey } from '../commerce/payments.ts';
import type { CommerceRepository, OpsPayment } from '../commerce/repository.ts';
import { GatewayError, type PaymentGateway } from './gateway.ts';
import { MockPaymentProvider } from './mock-provider.ts';
import { PaymentOSAdapter } from './paymentos.ts';

export type PaymentServiceError = PaymentError | GatewayError;

export function getPaymentGateway(env: Record<string, string | undefined> = process.env): PaymentGateway {
  try {
    return PaymentOSAdapter.fromEnv(env);
  } catch (error) {
    if (error instanceof GatewayError && error.code === 'gateway-unconfigured') {
      // No PaymentOS credentials: local/test mock (refuses production itself).
      return new MockPaymentProvider(env);
    }
    throw error;
  }
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
  gateway: PaymentGateway,
  input: InitiateMpesaInput,
  ctx: { now?: string } = {},
): Promise<{ payment: OpsPayment; duplicate: boolean; providerRequestId: string }> {
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

  const amount = assertInitiationAmount(order.total);
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
    provider: gateway.provider === 'MOCK' ? 'PAYMENTOS' : gateway.provider,
    method: 'MPESA',
    amount,
    currencyCode: order.currencyCode,
    customerPhone: phone,
    idempotencyKey: key,
    attemptNumber: attempt,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
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
      idempotencyKey: key,
      callbackUrl: input.callbackBaseUrl ? `${input.callbackBaseUrl}/api/v1/payments/callback?pid=${created.payment.id}` : null,
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
 * Handle a verified provider callback. Verifies authenticity via the gateway
 * FIRST, then scopes everything to the payment's tenant. Convergent on
 * re-delivery: repeated callbacks return the stored outcome.
 */
export async function handlePaymentCallback(
  repo: CommerceRepository,
  gateway: PaymentGateway,
  input: { rawBody: string; headers: Record<string, string | undefined>; paymentId?: string | null },
): Promise<CallbackOutcome & { paymentId: string }> {
  const event = gateway.parseCallback(input.rawBody, input.headers);

  const payment = input.paymentId
    ? await repo.getPaymentByIdGlobal(input.paymentId)
    : null;
  const located =
    payment ??
    (await findPaymentByProviderRequest(repo, event.providerRequestId));
  if (!located) {
    throw new PaymentError('unknown-payment', 'Callback references an unknown payment.');
  }
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
        authoritativeTotal: found.order.total,
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

  if (event.status === 'FAILED' || event.status === 'EXPIRED') {
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

async function findPaymentByProviderRequest(
  repo: CommerceRepository,
  providerRequestId: string,
): Promise<OpsPayment | null> {
  return repo.getPaymentByProviderRequestGlobal(providerRequestId);
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
  gateway: PaymentGateway,
  input: RetryMpesaInput,
) {
  const found = await repo.getOrderWithItems(input.tenantId, input.orderId);
  if (!found) {
    throw new PaymentError('unknown-payment', 'Order not found for this shop.');
  }
  if (found.order.status === 'COMPLETED') {
    throw new PaymentError('invalid-transition', 'That order is already completed.');
  }
  return initiateMpesaPayment(repo, gateway, {
    tenantId: input.tenantId,
    orderId: input.orderId,
    actorId: input.actorId,
    customerPhone: input.customerPhone ?? found.order.customerPhone ?? null,
    callbackBaseUrl: input.callbackBaseUrl ?? null,
  });
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
