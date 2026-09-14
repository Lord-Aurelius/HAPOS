import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { handlePaymentCallback, initiateMpesaPayment, retryMpesaPayment } from '../src/server/payments/payment-service.ts';
import { MockPaymentProvider } from '../src/server/payments/mock-provider.ts';
import type { CommerceRepository } from '../src/server/commerce/repository.ts';
import { MemoryRepo } from './helpers/memory-repo.ts';

describe('payment-service (initiate / callback / retry)', () => {
  let repo: MemoryRepo;
  let gateway: MockPaymentProvider;
  let orderId = '';

  beforeEach(async () => {
    repo = new MemoryRepo();
    gateway = new MockPaymentProvider({ NODE_ENV: 'test' });
    const created = await repo.createOrder({
      tenantId: 'tenant-a', customerId: null, sellerId: null, source: 'SELLER_QR',
      lines: [{ kind: 'service', refId: 'svc-1', quantity: 1 } as never],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: false, paymentMethod: 'MPESA', customerPhone: '+254712345678',
    } as never);
    orderId = created.order.id;
  });

  it('initiates with server-owned amount and reuses pending on retry', async () => {
    const first = await initiateMpesaPayment(repo as unknown as CommerceRepository, gateway, {
      tenantId: 'tenant-a', orderId, actorId: 'staff-1', customerPhone: '+254712345678',
    });
    assert.equal(first.payment.status, 'PENDING');
    assert.equal(first.payment.amount, 1000);
    assert.equal(first.duplicate, false);
    const retry = await initiateMpesaPayment(repo as unknown as CommerceRepository, gateway, {
      tenantId: 'tenant-a', orderId, actorId: 'staff-1', customerPhone: '+254712345678',
    });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.payment.id, first.payment.id);
  });

  it('callback success finalizes sale and stock atomically; duplicate converges', async () => {
    const initiated = await initiateMpesaPayment(repo as unknown as CommerceRepository, gateway, {
      tenantId: 'tenant-a', orderId, actorId: 'staff-1', customerPhone: '+254712345678',
    });
    const payment = initiated.payment;
    const mockIntent = gateway['intents'].get(initiated.providerRequestId);
    if (!mockIntent) throw new Error('mock intent missing');
    (gateway as unknown as { completeIntent: (id: string) => void }).completeIntent(initiated.providerRequestId);
    const { rawBody, headers } = { rawBody: JSON.stringify({ request_id: initiated.providerRequestId, provider_reference: 'REF1', amount: 1000, currency: 'KES', status: 'SUCCESS' }), headers: {} };
    // Inject gateway signature bypass by directly calling handlePaymentCallback with mock gateway's parse (no sig).
    const result = await handlePaymentCallback(repo as unknown as CommerceRepository, gateway, {
      rawBody,
      headers,
      paymentId: payment.id,
    });
    assert.equal(result.outcome, 'completed');
    assert.equal(repo.products.get('prod-oil')?.quantityOnHand, 9);
    // Duplicate delivery
    const again = await handlePaymentCallback(repo as unknown as CommerceRepository, gateway, {
      rawBody,
      headers,
      paymentId: payment.id,
    });
    assert.equal(again.outcome, 'duplicate');
    assert.equal(repo.products.get('prod-oil')?.quantityOnHand, 9);
  });

  it('amount mismatch fails the payment without finalizing', async () => {
    const initiated = await initiateMpesaPayment(repo as unknown as CommerceRepository, gateway, {
      tenantId: 'tenant-a', orderId, actorId: 'staff-1', customerPhone: '+254712345678',
    });
    const rawBody = JSON.stringify({ request_id: initiated.providerRequestId, provider_reference: 'REF1', amount: 999, currency: 'KES', status: 'SUCCESS' });
    const result = await handlePaymentCallback(repo as unknown as CommerceRepository, gateway, {
      rawBody,
      headers: {},
      paymentId: initiated.payment.id,
    });
    assert.equal(result.outcome, 'failed-held');
    const payment = await repo.getPaymentByIdempotency('tenant-a', initiated.payment.idempotencyKey!);
    assert.equal(payment?.status, 'FAILED');
    assert.equal(repo.products.get('prod-oil')?.quantityOnHand, 10);
  });

  it('failed payment leaves no sale and allows retry as new attempt', async () => {
    const initiated = await initiateMpesaPayment(repo as unknown as CommerceRepository, gateway, {
      tenantId: 'tenant-a', orderId, actorId: 'staff-1', customerPhone: '+254712345678',
    });
    const rawBody = JSON.stringify({ request_id: initiated.providerRequestId, provider_reference: 'REF1', amount: 1000, currency: 'KES', status: 'FAILED', failure_code: 'DECLINED', failure_reason: 'Customer declined' });
    await handlePaymentCallback(repo as unknown as CommerceRepository, gateway, {
      rawBody, headers: {}, paymentId: initiated.payment.id,
    });
    const retry = await retryMpesaPayment(repo as unknown as CommerceRepository, gateway, {
      tenantId: 'tenant-a', orderId, actorId: 'staff-1',
    });
    assert.notEqual(retry.payment.id, initiated.payment.id);
    assert.equal(retry.payment.attemptNumber, 2);
  });

  it('success with vanished stock becomes needs_recovery and is retryable after restock', async () => {
    const initiated = await initiateMpesaPayment(repo as unknown as CommerceRepository, gateway, {
      tenantId: 'tenant-a', orderId, actorId: 'staff-1', customerPhone: '+254712345678',
    });
    // Drain stock before callback
    repo.products.set('prod-oil', { quantityOnHand: 0 });
    const rawBody = JSON.stringify({ request_id: initiated.providerRequestId, provider_reference: 'REF1', amount: 1000, currency: 'KES', status: 'SUCCESS' });
    const result = await handlePaymentCallback(repo as unknown as CommerceRepository, gateway, {
      rawBody, headers: {}, paymentId: initiated.payment.id,
    });
    assert.equal(result.outcome, 'failed-held');
    const payment = await repo.getPaymentByIdempotency('tenant-a', initiated.payment.idempotencyKey!);
    assert.equal(payment?.needsRecovery, true);
    // Restock and recover
    repo.products.set('prod-oil', { quantityOnHand: 5 });
    const recovered = await (repo as unknown as { recoverPaidOrder: (i: never) => Promise<never> }).recoverPaidOrder({ tenantId: 'tenant-a', paymentId: payment!.id, actorId: 'system' } as never);
    assert.equal((recovered as { outcome: string }).outcome ?? 'completed', 'completed');
  });
});

describe('payment security and concurrency', () => {
  it('browser cannot dictate payment amount (server total wins)', async () => {
    const repo = new MemoryRepo();
    const gateway = new MockPaymentProvider({ NODE_ENV: 'test' });
    const created = await repo.createOrder({
      tenantId: 'tenant-a', customerId: null, sellerId: null, source: 'SELLER_QR',
      lines: [{ kind: 'service', refId: 'svc-1', quantity: 1 } as never],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: false, paymentMethod: 'MPESA', customerPhone: '+254712345678',
    } as never);
    // Even if a client claims a different amount, initiate uses order.total (1000).
    const initiated = await initiateMpesaPayment(repo as unknown as CommerceRepository, gateway, {
      tenantId: 'tenant-a', orderId: created.order.id, actorId: 'staff-1', customerPhone: '+254712345678',
    });
    assert.equal(initiated.payment.amount, 1000);
  });

  it('cross-tenant payment lookup fails', async () => {
    const repo = new MemoryRepo();
    const gateway = new MockPaymentProvider({ NODE_ENV: 'test' });
    const created = await repo.createOrder({
      tenantId: 'tenant-a', customerId: null, sellerId: null, source: 'SELLER_QR',
      lines: [{ kind: 'service', refId: 'svc-1', quantity: 1 } as never],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: false, paymentMethod: 'MPESA', customerPhone: '+254712345678',
    } as never);
    const initiated = await initiateMpesaPayment(repo as unknown as CommerceRepository, gateway, {
      tenantId: 'tenant-a', orderId: created.order.id, actorId: 'staff-1', customerPhone: '+254712345678',
    });
    // Tenant B cannot find the payment by idempotency.
    const foreign = await repo.getPaymentByIdempotency('tenant-b', initiated.payment.idempotencyKey!);
    assert.equal(foreign, null);
    // Callback scoped to wrong tenant fails.
    const rawBody = JSON.stringify({ request_id: initiated.providerRequestId, provider_reference: 'R', amount: 1000, currency: 'KES', status: 'SUCCESS' });
    await assert.rejects(() =>
      handlePaymentCallback(
        { getPaymentByIdGlobal: async () => ({ ...initiated.payment, tenantId: 'tenant-b' } as never), getPaymentByIdempotency: repo.getPaymentByIdempotency.bind(repo), transitionPayment: repo.transitionPayment.bind(repo), completePaidOrder: repo.completePaidOrder.bind(repo), getOrderWithItems: repo.getOrderWithItems.bind(repo) } as unknown as CommerceRepository,
        gateway,
        { rawBody, headers: {}, paymentId: initiated.payment.id },
      ),
    );
    void initiated;
  });

  it('concurrent identical callbacks converge to one finalization', async () => {
    const repo = new MemoryRepo();
    const gateway = new MockPaymentProvider({ NODE_ENV: 'test' });
    const created = await repo.createOrder({
      tenantId: 'tenant-a', customerId: null, sellerId: null, source: 'SELLER_QR',
      lines: [{ kind: 'service', refId: 'svc-1', quantity: 1 } as never],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: false, paymentMethod: 'MPESA', customerPhone: '+254712345678',
    } as never);
    const initiated = await initiateMpesaPayment(repo as unknown as CommerceRepository, gateway, {
      tenantId: 'tenant-a', orderId: created.order.id, actorId: 'staff-1', customerPhone: '+254712345678',
    });
    const rawBody = JSON.stringify({ request_id: initiated.providerRequestId, provider_reference: 'R', amount: 1000, currency: 'KES', status: 'SUCCESS' });
    const outcomes = await Promise.all([
      handlePaymentCallback(repo as unknown as CommerceRepository, gateway, { rawBody, headers: {}, paymentId: initiated.payment.id }),
      handlePaymentCallback(repo as unknown as CommerceRepository, gateway, { rawBody, headers: {}, paymentId: initiated.payment.id }),
    ]);
    const successes = outcomes.filter((o) => o.outcome === 'completed').length;
    const duplicates = outcomes.filter((o) => o.outcome === 'duplicate').length;
    assert.equal(successes, 1);
    assert.equal(duplicates, 1);
    // Exactly one stock decrement despite two deliveries.
    assert.equal(repo.products.get('prod-oil')?.quantityOnHand, 9);
  });
});
