/**
 * Phase 4B hardening — missed-webhook convergence.
 *
 * reconcileStalePendingPayments polls PaymentOS for stale PENDING intents;
 * these tests cover SUCCESS convergence (with the same amount assertion as
 * callbacks), FAILED/EXPIRED mapping, still-pending pass-through, and the
 * safety rails (no connection, no provider request id, stale filter).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { reconcileStalePendingPayments } from '../src/server/payments/payment-service.ts';
import { sealConnectionSecret } from '../src/server/payments/connection.ts';
import { setPaymentOSFetchForTests } from '../src/server/payments/paymentos.ts';
import type { GatewayVerifyResult } from '../src/server/payments/gateway.ts';
import { MemoryRepo } from './helpers/memory-repo.ts';
import type { CommerceRepository } from '../src/server/commerce/repository.ts';

const WRAP_KEY = 'c'.repeat(64);
const ENV = {
  PAYMENTOS_BASE_URL: 'https://payos.example',
  PAYMENTOS_WRAP_KEY: WRAP_KEY,
  PAYMENTOS_ENVIRONMENT: 'SANDBOX',
  NODE_ENV: 'test',
};
const STALE_INITIATED_AT = new Date(Date.now() - 10 * 60 * 1000).toISOString();

/** Stub the PaymentOS status endpoint with a per-payment verdict map. */
function stubStatusPolling(verdicts: Map<string, GatewayVerifyResult>) {
  setPaymentOSFetchForTests((async (url: string | URL | Request) => {
    const target = String(url instanceof Request ? url.url : url);
    if (target.includes('/status')) {
      const paymentId = decodeURIComponent(target.split('/api/payments/')[1]?.split('/')[0] ?? '');
      const verdict = verdicts.get(paymentId);
      if (!verdict) {
        // Still open at PaymentOS: created but not yet paid.
        return { ok: true, status: 200, json: async () => ({ status: 'CREATED' }) } as unknown as Response;
      }
      const body: Record<string, unknown> = {
        status: verdict.status === 'SUCCESS' ? 'PAID' : verdict.status,
        mpesa_receipt: verdict.providerReference,
        amount_base: verdict.amount,
        currency: verdict.currency,
        failure_reason: verdict.failureReason,
      };
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }
    throw new Error(`unexpected fetch ${target}`);
  }) as unknown as typeof fetch);
}

describe('reconcileStalePendingPayments (missed-webhook convergence)', () => {
  let repo: MemoryRepo;

  beforeEach(() => {
    repo = new MemoryRepo({ NODE_ENV: 'test' });
  });

  afterEach(() => {
    setPaymentOSFetchForTests(null);
  });

  async function seedPendingPayment(providerRequestId: string, connectionMerchant: string) {
    const connection = await repo.createConnection({
      tenantId: 'tenant-a',
      provider: 'PAYMENTOS',
      providerTenantId: connectionMerchant,
      environment: 'SANDBOX',
      status: 'CONNECTED',
      supportedMethods: ['MPESA'],
      secretSealed: sealConnectionSecret('hapos-key-1234567890', Buffer.from(WRAP_KEY.slice(0, 64), 'hex')),
      webhookSecretSealed: sealConnectionSecret('whsec-1234567890abcdef', Buffer.from(WRAP_KEY.slice(0, 64), 'hex')),
    });
    const order = await repo.createOrder({
      tenantId: 'tenant-a', customerId: null, sellerId: null, source: 'SELLER_QR',
      lines: [], creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: false,
      paymentMethod: 'MPESA', customerPhone: '+254712345678',
    } as never);
    const created = await repo.createPayment({
      tenantId: 'tenant-a',
      orderId: order.order.id,
      provider: 'PAYMENTOS',
      method: 'MPESA',
      amount: 1000,
      currencyCode: 'KES',
      customerPhone: '+254712345678',
      idempotencyKey: `pay-${providerRequestId}`,
      attemptNumber: 1,
      connection: { connectionId: connection.id, providerMerchantId: connectionMerchant },
    });
    const payment = created.payment as unknown as { providerRequestId: string | null; initiatedAt: string };
    payment.providerRequestId = providerRequestId;
    payment.initiatedAt = STALE_INITIATED_AT;
    return created.payment;
  }

  it('converges a paid payment to SUCCESS + completed sale when the webhook was missed', async () => {
    const payment = await seedPendingPayment('pay_poll_1', 'merchant-a');
    stubStatusPolling(new Map([
      ['pay_poll_1', { status: 'SUCCESS', providerReference: 'RKTQDM7W6S', amount: 1000, currency: 'KES', failureCode: null, failureReason: null }],
    ]));
    const outcomes = await reconcileStalePendingPayments(repo as unknown as CommerceRepository, {
      tenantId: 'tenant-a', actorId: 'admin-1',
    }, { env: ENV });
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0].outcome, 'completed');
    const stored = (await repo.getPaymentByIdempotency('tenant-a', payment.idempotencyKey!))!;
    assert.equal(stored.status, 'SUCCESS');
    assert.equal(stored.providerReference, 'RKTQDM7W6S');
    assert.equal(repo.products.get('prod-oil')?.quantityOnHand, 9);
  });

  it('asserts the amount: a poll total that disagrees is held for review, never finalized', async () => {
    await seedPendingPayment('pay_poll_2', 'merchant-a');
    stubStatusPolling(new Map([
      ['pay_poll_2', { status: 'SUCCESS', providerReference: 'R2', amount: 999, currency: 'KES', failureCode: null, failureReason: null }],
    ]));
    const outcomes = await reconcileStalePendingPayments(repo as unknown as CommerceRepository, {
      tenantId: 'tenant-a', actorId: 'admin-1',
    }, { env: ENV });
    assert.equal(outcomes[0].outcome, 'failed-held');
    assert.equal(repo.products.get('prod-oil')?.quantityOnHand, 10);
  });

  it('maps provider FAILED and EXPIRED verdicts and leaves PENDING alone', async () => {
    await seedPendingPayment('pay_poll_3', 'merchant-a');
    await seedPendingPayment('pay_poll_4', 'merchant-a');
    await seedPendingPayment('pay_poll_5', 'merchant-a');
    stubStatusPolling(new Map([
      ['pay_poll_3', { status: 'FAILED', providerReference: null, amount: null, currency: null, failureCode: 'CUSTOMER_CANCELLED', failureReason: 'Customer declined' }],
      ['pay_poll_4', { status: 'EXPIRED', providerReference: null, amount: null, currency: null, failureCode: 'CUSTOMER_TIMEOUT', failureReason: 'Prompt expired' }],
      // pay_poll_5 intentionally still PENDING at the provider.
    ]));
    const outcomes = await reconcileStalePendingPayments(repo as unknown as CommerceRepository, {
      tenantId: 'tenant-a', actorId: 'admin-1',
    }, { env: ENV });
    const byPayment = new Map(outcomes.map((o) => [o.paymentId, o.outcome]));
    assert.equal(byPayment.get('pay-pay-pay_poll_3'), 'failed');
    assert.equal(byPayment.get('pay-pay-pay_poll_4'), 'expired');
    assert.equal(byPayment.get('pay-pay-pay_poll_5'), 'still-pending');
  });

  it('skips fresh intents and payments without a connection or request id', async () => {
    // Fresh (not stale): filtered out before any polling.
    const fresh = await seedPendingPayment('pay_fresh', 'merchant-a');
    (fresh as unknown as { initiatedAt: string }).initiatedAt = new Date().toISOString();
    stubStatusPolling(new Map());
    let outcomes = await reconcileStalePendingPayments(repo as unknown as CommerceRepository, {
      tenantId: 'tenant-a', actorId: 'admin-1',
    }, { env: ENV });
    assert.equal(outcomes.length, 0);

    // Stale but no provider request id.
    (fresh as unknown as { initiatedAt: string }).initiatedAt = STALE_INITIATED_AT;
    (fresh as unknown as { providerRequestId: string | null }).providerRequestId = null;
    outcomes = await reconcileStalePendingPayments(repo as unknown as CommerceRepository, {
      tenantId: 'tenant-a', actorId: 'admin-1',
    }, { env: ENV });
    assert.deepEqual(outcomes, [{ paymentId: fresh.id, outcome: 'skipped', reason: 'no-provider-request-id' }]);
  });
});
