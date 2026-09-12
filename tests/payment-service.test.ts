import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { CommerceError } from '../src/server/commerce/orders.ts';
import { PaymentError } from '../src/server/commerce/payments.ts';
import { handlePaymentCallback, initiateMpesaPayment, retryMpesaPayment } from '../src/server/payments/payment-service.ts';
import { MockPaymentProvider } from '../src/server/payments/mock-provider.ts';
import type { CommerceRepository, OpsOrder, OpsPayment } from '../src/server/commerce/repository.ts';

// In-memory repository stub for payment-service tests (no SQL, no file globals).
class MemoryRepo {
  readonly backend = 'file' as const;
  orders: Map<string, OpsOrder> = new Map();
  payments: Map<string, OpsPayment> = new Map();
  products: Map<string, { quantityOnHand: number }> = new Map();
  sales: Map<string, { id: string; orderId: string }> = new Map();
  orderCounter = 0;

  constructor() {
    this.products.set('prod-oil', { quantityOnHand: 10 });
  }

  async getTenantPolicy() {
    return { orderReviewRequired: false, timezone: 'Africa/Nairobi', currencyCode: 'KES', slug: 's', name: 'S' };
  }
  async getCatalogProducts() { return [] as never; }
  async getCatalogServices() { return [] as never; }
  async getProductBalance(_t: string, pid: string) { return this.products.get(pid)?.quantityOnHand ?? 0; }

  async createOrder(input: never) {
    const order = {
      id: `order-${++this.orderCounter}`,
      tenantId: (input as { tenantId: string }).tenantId,
      customerId: null,
      sellerId: null,
      status: 'PENDING_REVIEW' as const,
      subtotal: 1000,
      total: 1000,
      currencyCode: 'KES',
      source: 'SELLER_QR',
      notes: null,
      idempotencyKey: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      paymentMethod: (input as { paymentMethod?: string | null }).paymentMethod ?? null,
      customerPhone: (input as { customerPhone?: string | null }).customerPhone ?? null,
    } as unknown as OpsOrder;
    this.orders.set(order.id, order);
    return { order, items: [], duplicate: false };
  }
  async submitOrder(input: { orderId: string }) {
    const order = this.orders.get(input.orderId);
    if (!order) throw new CommerceError('unknown-item', 'missing');
    order.status = 'PENDING_REVIEW' as never;
    return { order, route: 'PENDING_REVIEW' as const };
  }
  async approveOrder() { throw new Error('not used'); }
  async finalizeApprovedOrder() { throw new Error('not used'); }
  async rejectOrder() { throw new Error('not used'); }
  async cancelOrder() { throw new Error('not used'); }
  async voidSale() { throw new Error('not used'); }
  async getOrderWithItems(tenantId: string, orderId: string) {
    const order = this.orders.get(orderId);
    if (!order || order.tenantId !== tenantId) return null;
    return { order, items: [] };
  }
  async getSaleWithItems() { return null as never; }
  async postInventoryMovement() { throw new Error('not used'); }
  async postOpeningBalance() { throw new Error('not used'); }
  async adjustProductStock() { throw new Error('not used'); }
  async consumeServiceBom() { return [] as never; }

  async createPayment(input: { tenantId: string; orderId?: string | null; provider: string; method: string; amount: number; currencyCode: string; customerPhone?: string | null; idempotencyKey: string; attemptNumber: number }) {
    const existing = [...this.payments.values()].find((p) => p.idempotencyKey === input.idempotencyKey && p.tenantId === input.tenantId);
    if (existing) return { payment: existing, duplicate: true };
    const payment = {
      id: `pay-${input.idempotencyKey}`,
      tenantId: input.tenantId,
      orderId: input.orderId ?? null,
      saleId: null,
      provider: input.provider as never,
      method: input.method as never,
      status: 'PENDING' as const,
      amount: input.amount,
      currencyCode: input.currencyCode,
      customerPhone: input.customerPhone ?? null,
      providerReference: null,
      providerRequestId: null,
      idempotencyKey: input.idempotencyKey,
      attemptNumber: input.attemptNumber,
      initiatedAt: new Date().toISOString(),
      confirmedAt: null,
      failedAt: null,
      expiresAt: null,
      failureCode: null,
      failureReason: null,
      needsRecovery: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as OpsPayment;
    this.payments.set(payment.id, payment);
    return { payment, duplicate: false };
  }
  async transitionPayment(input: { tenantId: string; paymentId: string; to: string; providerReference?: string | null; failureCode?: string | null; failureReason?: string | null }) {
    const payment = this.payments.get(input.paymentId);
    if (!payment || payment.tenantId !== input.tenantId) throw new PaymentError('unknown-payment', 'missing');
    if (payment.status !== 'PENDING') return { payment, duplicate: true };
    payment.status = input.to as never;
    if (input.providerReference) payment.providerReference = input.providerReference;
    if (input.to === 'SUCCESS') payment.confirmedAt = new Date().toISOString();
    else {
      payment.failedAt = new Date().toISOString();
      payment.failureCode = input.failureCode ?? null;
      payment.failureReason = input.failureReason ?? null;
    }
    return { payment, duplicate: false };
  }
  async getPaymentByIdempotency(tenantId: string, key: string) {
    return [...this.payments.values()].find((p) => p.tenantId === tenantId && p.idempotencyKey === key) ?? null;
  }
  async getPaymentByProviderRequest() { return null as never; }
  async getPaymentByProviderRequestGlobal(providerRequestId: string) {
    return [...this.payments.values()].find((p) => p.providerRequestId === providerRequestId) ?? null;
  }
  async getPaymentByIdGlobal(paymentId: string) {
    return this.payments.get(paymentId) ?? null;
  }
  async updatePaymentProviderDetails(input: { tenantId: string; paymentId: string; providerRequestId?: string | null; providerReference?: string | null; expiresAt?: string | null }) {
    const payment = this.payments.get(input.paymentId);
    if (!payment) throw new PaymentError('unknown-payment', 'missing');
    if (input.providerRequestId) payment.providerRequestId = input.providerRequestId;
    if (input.providerReference) payment.providerReference = input.providerReference;
    if (input.expiresAt) payment.expiresAt = input.expiresAt;
    return payment;
  }
  async completePaidOrder(input: { tenantId: string; orderId: string; paymentId: string }) {
    const payment = this.payments.get(input.paymentId);
    const order = this.orders.get(input.orderId);
    if (!payment || !order) throw new CommerceError('unknown-item', 'missing');
    if (order.status === 'COMPLETED') throw new CommerceError('already-approved', 'already');
    // Simulate stock check: if quantity would go negative, flag recovery.
    const product = this.products.get('prod-oil');
    if (product && product.quantityOnHand < 1) {
      payment.needsRecovery = true;
      payment.status = 'SUCCESS' as never;
      return { order, sale: { id: 'sale-x', orderId: order.id } as never, payment, outcome: 'needs-recovery' as const };
    }
    if (product) product.quantityOnHand -= 1;
    order.status = 'COMPLETED' as never;
    const sale: { id: string; orderId: string; status: string } = { id: `sale-${order.id}`, orderId: order.id, status: 'COMPLETED' };
    this.sales.set((sale as unknown as { id: string }).id, sale as unknown as never);
    (payment as unknown as { saleId: string | null }).saleId = sale.id;
    payment.status = 'SUCCESS' as never;
    return { order, sale: sale as unknown as never, payment, outcome: 'completed' as const };
  }
  async recoverPaidOrder(input: { tenantId: string; paymentId: string; actorId: string }) {
    const payment = this.payments.get(input.paymentId);
    if (!payment || !payment.needsRecovery) throw new CommerceError('invalid-transition', 'no recovery');
    const order = [...this.orders.values()].find((o) => (o as unknown as { id: string }).id === (payment as unknown as { orderId: string }).orderId);
    if (!order) throw new CommerceError('unknown-item', 'missing');
    return this.completePaidOrder({ tenantId: input.tenantId, orderId: (order as unknown as { id: string }).id, paymentId: payment.id, actorId: input.actorId } as never);
  }
  async getPaymentsByOrder(tenantId: string, orderId: string) {
    return [...this.payments.values()].filter((p) => p.tenantId === tenantId && p.orderId === orderId);
  }
  async markPaymentRecovery(tenantId: string, paymentId: string, _reason: string) {
    const payment = this.payments.get(paymentId);
    if (!payment || payment.tenantId !== tenantId) throw new PaymentError('unknown-payment', 'missing');
    payment.needsRecovery = true;
    return payment;
  }
  // Credential methods unused in this suite — type-correct stubs.
  async verifySellerCredential(_a: string, _b: unknown, _c: unknown): Promise<never> { throw new Error('not used'); }
  async touchSellerCredentialUsed(): Promise<void> {}
  async resolveSellerCredentialTenant(): Promise<null> { return null as never; }
  async getSellerSales() { return { orders: [], sales: [] } as never; }
  async getAdminOrders() { return [] as never; }
  async listPayments(tenantId: string) { return [...this.payments.values()].filter((p) => p.tenantId === tenantId); }
  async getOrderView() { return null as never; }
  async getSaleView() { return null as never; }
  async listOrderViews() { return [] as never; }
  async listSaleViews() { return [] as never; }
}

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
