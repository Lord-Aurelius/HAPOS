/**
 * Shared in-memory repository helper for payment tests (no SQL, no file
 * globals). Implements the CommerceRepository payment + connection surface
 * used by the Phase 4/4B service tests; unused operations throw so tests
 * fail loudly if they reach an unimplemented path.
 */
import { CommerceError } from '../../src/server/commerce/orders.ts';
import { PaymentError } from '../../src/server/commerce/payments.ts';
import type { OpsOrder, OpsPayment, OpsPaymentConnectionEvent } from '../../src/server/commerce/repository.ts';
import type { OpsPaymentConnection, PaymentConnectionMethod, PaymentConnectionStatus } from '../../src/server/payments/connection.ts';
import type { GatewayHealthResult } from '../../src/server/payments/gateway.ts';

export class MemoryRepo {
  readonly backend = 'file' as const;
  orders: Map<string, OpsOrder> = new Map();
  payments: Map<string, OpsPayment> = new Map();
  products: Map<string, { quantityOnHand: number }> = new Map();
  sales: Map<string, { id: string; orderId: string }> = new Map();
  orderCounter = 0;
  connections: Map<string, OpsPaymentConnection> = new Map();
  connectionEvents: OpsPaymentConnectionEvent[] = [];
  /** Simulated PaymentOS health response (driven by tests via fetch stub). */
  healthResponse: GatewayHealthResult = { connected: true, mpesaAccount: null, failure: null };
  /** Set true to simulate the SQL one-active partial unique index. */
  forceOneActiveConstraint = false;

  constructor(_env: Record<string, string | undefined> = process.env) {
    void _env;
    this.products.set('prod-oil', { quantityOnHand: 10 });
  }

  // ── catalog / policy ──
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

  // ── payments ──
  async createPayment(input: { tenantId: string; orderId?: string | null; provider: string; method: string; amount: number; currencyCode: string; customerPhone?: string | null; idempotencyKey: string; attemptNumber: number; connection?: { connectionId: string; providerMerchantId: string | null } | null; createdBy?: string | null }) {
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
      connection: input.connection ?? null,
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
    this.sales.set(sale.id, sale as unknown as never);
    payment.saleId = sale.id;
    payment.status = 'SUCCESS' as never;
    return { order, sale: sale as unknown as never, payment, outcome: 'completed' as const };
  }
  async recoverPaidOrder(input: { tenantId: string; paymentId: string; actorId: string }) {
    const payment = this.payments.get(input.paymentId);
    if (!payment || !payment.needsRecovery) throw new CommerceError('invalid-transition', 'no recovery');
    const orderId = (payment as unknown as { orderId?: string | null }).orderId;
    if (!orderId) throw new CommerceError('unknown-item', 'missing');
    const paymentRow = payment as unknown as { needsRecovery: boolean };
    paymentRow.needsRecovery = false;
    return this.completePaidOrder({ tenantId: input.tenantId, orderId, paymentId: input.paymentId });
  }
  async getPaymentsByOrder(tenantId: string, orderId: string) {
    return [...this.payments.values()].filter((p) => p.tenantId === tenantId && p.orderId === orderId);
  }
  async markPaymentRecovery() { throw new Error('not used'); }
  async listPayments(tenantId: string) {
    return [...this.payments.values()].filter((p) => p.tenantId === tenantId);
  }

  // ── payment connections (Phase 4B) ──
  async getConnectionById(tenantId: string, connectionId: string) {
    const row = this.connections.get(connectionId);
    return row && row.tenantId === tenantId ? row : null;
  }
  async getActiveConnection(tenantId: string) {
    return [...this.connections.values()].find((c) => c.tenantId === tenantId && c.status === 'CONNECTED') ?? null;
  }
  async listConnections(tenantId: string) {
    return [...this.connections.values()].filter((c) => c.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async findConnectionByProviderTenantId(providerTenantId: string) {
    return [...this.connections.values()].find((c) => c.providerTenantId === providerTenantId) ?? null;
  }
  async createConnection(input: { tenantId: string; provider: string; providerTenantId: string; environment: string; status: string; supportedMethods: PaymentConnectionMethod[]; secretSealed: string | null; webhookSecretSealed: string | null; displayName?: string | null; connectedAt?: string | null; lastVerifiedAt?: string | null }) {
    if (this.forceOneActiveConstraint && input.status === 'CONNECTED') {
      const clash = [...this.connections.values()].some(
        (c) => c.tenantId === input.tenantId && c.environment === input.environment && c.status === 'CONNECTED',
      );
      if (clash) {
        throw new Error('one active payment connection per tenant per environment');
      }
    }
    const row = {
      id: `conn-${input.providerTenantId}-${this.connections.size + 1}`,
      tenantId: input.tenantId,
      provider: input.provider as never,
      providerTenantId: input.providerTenantId,
      environment: input.environment as never,
      status: input.status as never,
      displayName: input.displayName ?? null,
      supportedMethods: [...input.supportedMethods] as never,
      connectedAt: input.connectedAt ?? null,
      lastVerifiedAt: input.lastVerifiedAt ?? null,
      disconnectedAt: null,
      lastCheckCode: null,
      lastCheckMessage: null,
      secretSealed: input.secretSealed,
      webhookSecretSealed: input.webhookSecretSealed,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as OpsPaymentConnection;
    this.connections.set(row.id, row);
    return row;
  }
  async updateConnection(input: { tenantId: string; connectionId: string; status?: PaymentConnectionStatus; lastVerifiedAt?: string | null; lastCheckCode?: string | null; lastCheckMessage?: string | null; connectedAt?: string | null; disconnectedAt?: string | null; secretSealed?: string | null; webhookSecretSealed?: string | null; displayName?: string | null; supportedMethods?: PaymentConnectionMethod[] }) {
    const row = this.connections.get(input.connectionId);
    if (!row || row.tenantId !== input.tenantId) throw new Error('connection missing');
    if (input.status !== undefined) row.status = input.status;
    if (input.lastVerifiedAt !== undefined) row.lastVerifiedAt = input.lastVerifiedAt;
    if (input.lastCheckCode !== undefined) row.lastCheckCode = input.lastCheckCode;
    if (input.lastCheckMessage !== undefined) row.lastCheckMessage = input.lastCheckMessage;
    if (input.connectedAt !== undefined) row.connectedAt = input.connectedAt;
    if (input.disconnectedAt !== undefined) row.disconnectedAt = input.disconnectedAt;
    if (input.secretSealed !== undefined) row.secretSealed = input.secretSealed;
    if (input.webhookSecretSealed !== undefined) row.webhookSecretSealed = input.webhookSecretSealed;
    if (input.displayName !== undefined) row.displayName = input.displayName;
    if (input.supportedMethods !== undefined) row.supportedMethods = [...input.supportedMethods] as never;
    row.updatedAt = new Date().toISOString();
    return row;
  }

  // ── connection audit events (Phase 4B closure) ──
  async recordConnectionEvent(input: {
    tenantId: string;
    connectionId?: string | null;
    action: OpsPaymentConnectionEvent['action'];
    actorId?: string | null;
    actorRole?: string | null;
    result?: 'OK' | 'ERROR';
    oldProviderReference?: string | null;
    newProviderReference?: string | null;
  }): Promise<OpsPaymentConnectionEvent> {
    const event: OpsPaymentConnectionEvent = {
      id: `evt-${this.connectionEvents.length + 1}`,
      tenantId: input.tenantId,
      connectionId: input.connectionId ?? null,
      action: input.action,
      actorId: input.actorId ?? null,
      actorRole: input.actorRole ?? null,
      result: input.result ?? 'OK',
      oldProviderReference: input.oldProviderReference ?? null,
      newProviderReference: input.newProviderReference ?? null,
      createdAt: new Date().toISOString(),
    };
    this.connectionEvents.push(event);
    return event;
  }
  async listConnectionEvents(tenantId: string, filters: { connectionId?: string; limit?: number } = {}) {
    return this.connectionEvents
      .filter((event) => event.tenantId === tenantId)
      .filter((event) => !filters.connectionId || event.connectionId === filters.connectionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, filters.limit ?? 100);
  }
  async listAllConnectionsForAudit() {
    return [...this.connections.values()];
  }
}
