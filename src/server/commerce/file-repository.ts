/**
 * File-backed commerce repository (Phase 4, development/compatibility).
 *
 * Thin adapter: every operation delegates to the existing tested ops inside
 * one `updateStore` mutator (the file-mode transaction). No business rules
 * live here — they stay in the pure domain modules and ops functions shared
 * conceptually with the SQL adapter.
 *
 * App-only module (imports the store runtime): verified by tsc + build, not
 * by node:test. The SQL adapter carries the live-database test burden.
 */

import { randomUUID } from 'node:crypto';

import {
  adjustProductStock as adjustProductStockOp,
  consumeServiceBom as consumeServiceBomOp,
  postInventoryMovement as postInventoryMovementOp,
  postOpeningBalance as postOpeningBalanceOp,
} from '@/server/commerce/inventory-store';
import { applyMovement, resolveServiceConsumption } from '@/server/commerce/inventory';
import {
  approveOrder as approveOrderOp,
  cancelOrder as cancelOrderOp,
  createOrder as createOrderOp,
  finalizeApprovedOrder as finalizeApprovedOrderOp,
  rejectOrder as rejectOrderOp,
  submitOrder as submitOrderOp,
  voidSale as voidSaleOp,
  type CommerceStore,
} from '@/server/commerce/commerce-store';
import { CommerceError } from '@/server/commerce/orders';
import { PaymentError, transitionPaymentStatus } from '@/server/commerce/payments';
import { PaymentConnectionError } from '@/server/payments/connection';
import type {
  OpsPaymentConnection,
  OpsPaymentConnectionEvent,
  PaymentConnectionEnvironment,
  PaymentConnectionEventAction,
  PaymentConnectionMethod,
  PaymentConnectionProvider,
  PaymentConnectionStatus,
} from '@/server/payments/connection';
import {
  touchSellerCredentialUsed,
  verifySellerCredential as verifySellerCredentialOp,
} from '@/server/commerce/seller-store';
import { projectCompletedSaleToLegacyRecord } from '@/server/commerce/legacy-projection';
import type {
  CommerceRepository,
  CreatePaymentInput,
  OpContext,
  OpsCatalogProduct,
  OpsCatalogService,
  OpsMovement,
  OpsOrder,
  OpsOrderItem,
  OpsPayment,
  OpsSale,
  OpsSaleItem,
  OpsSellerContext,
  OpsTenantPolicy,
  PostMovementInput,
  TransitionPaymentInput,
} from '@/server/commerce/repository';
import { readStore, updateStore } from '@/server/store';
import type { StoreConnectionEvent, StorePaymentConnection, StoreState } from '@/server/store/types';
import { voidServiceRecord } from '@/server/store/service-records';
import {
  orderFromStore,
  saleFromStore,
} from '@/server/store/index';
import type { Order as OrderView, Sale as SaleView } from '@/lib/types';

function asCommerceStore(store: StoreState): CommerceStore {
  return store as unknown as CommerceStore;
}

function asSellerStore(store: StoreState): Parameters<typeof verifySellerCredentialOp>[0] {
  return store as unknown as Parameters<typeof verifySellerCredentialOp>[0];
}

/**
 * Project a freshly committed engine sale into the legacy service_record
 * read model (dashboard, reports, sales ledger all aggregate it). Runs inside
 * the caller's mutator so sale, stock and statistics projection commit
 * atomically. No-op when the sale is a duplicate or already projected.
 */
function projectFreshSaleToLegacy(
  store: StoreState,
  sale: { id: string; tenantId: string; orderId: string; customerId?: string | null; sellerId?: string | null; total: number; completedAt?: string | null },
  actorId: string,
  ctx: OpContext,
): void {
  const order = (store.orders ?? []).find((item) => item.id === sale.orderId && item.tenantId === sale.tenantId) ?? null;
  const items = (store.saleItems ?? [])
    .filter((item) => item.saleId === sale.id && item.tenantId === sale.tenantId)
    .map((item) => ({
      itemType: item.itemType,
      productId: item.productId ?? null,
      serviceId: item.serviceId ?? null,
      quantity: item.quantity,
      itemName: item.itemName,
      itemSnapshot: (item.itemSnapshot ?? null) as Record<string, unknown> | null,
    }));
  projectCompletedSaleToLegacyRecord(store, {
    sale,
    orderNotes: order?.notes ?? null,
    items,
    actorId,
    generateId: ctx.generateId,
  });
}

function paymentRow(store: StoreState, tenantId: string, paymentId: string) {
  const payment = (store.payments ?? []).find((item) => item.id === paymentId && item.tenantId === tenantId) ?? null;
  if (!payment) {
    throw new PaymentError('unknown-payment', 'Payment not found for this shop.');
  }
  return payment;
}

function toOpsConnectionEvent(row: StoreConnectionEvent): OpsPaymentConnectionEvent {
  return {
    id: row.id,
    tenantId: row.tenantId,
    connectionId: row.connectionId ?? null,
    action: row.action as OpsPaymentConnectionEvent['action'],
    actorId: row.actorId ?? null,
    actorRole: row.actorRole ?? null,
    result: (row.result ?? 'OK') as OpsPaymentConnectionEvent['result'],
    oldProviderReference: row.oldProviderReference ?? null,
    newProviderReference: row.newProviderReference ?? null,
    createdAt: row.createdAt,
  };
}

function toOpsConnection(row: StorePaymentConnection): OpsPaymentConnection {
  return {
    id: row.id,
    tenantId: row.tenantId,
    provider: row.provider as PaymentConnectionProvider,
    providerTenantId: row.providerTenantId ?? null,
    environment: row.environment as PaymentConnectionEnvironment,
    status: row.status as PaymentConnectionStatus,
    displayName: row.displayName ?? null,
    supportedMethods: (row.supportedMethods ?? []) as PaymentConnectionMethod[],
    connectedAt: row.connectedAt ?? null,
    lastVerifiedAt: row.lastVerifiedAt ?? null,
    disconnectedAt: row.disconnectedAt ?? null,
    lastCheckCode: row.lastCheckCode ?? null,
    lastCheckMessage: row.lastCheckMessage ?? null,
    secretSealed: row.secretSealed ?? null,
    webhookSecretSealed: row.webhookSecretSealed ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toOpsPayment(row: StoreState['payments'][number]): OpsPayment {
  return {
    id: row.id,
    tenantId: row.tenantId,
    orderId: row.orderId ?? null,
    saleId: row.saleId ?? null,
    provider: row.provider as OpsPayment['provider'],
    method: row.method as OpsPayment['method'],
    status: row.status as OpsPayment['status'],
    amount: row.amount,
    currencyCode: row.currencyCode,
    customerPhone: row.customerPhone ?? null,
    providerReference: row.providerReference ?? null,
    providerRequestId: row.providerRequestId ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    attemptNumber: row.attemptNumber,
    initiatedAt: row.initiatedAt,
    confirmedAt: row.confirmedAt ?? null,
    failedAt: row.failedAt ?? null,
    expiresAt: row.expiresAt ?? null,
    failureCode: row.failureCode ?? null,
    failureReason: row.failureReason ?? null,
    needsRecovery: row.needsRecovery ?? false,
    recoveryReason: row.recoveryReason ?? null,
    connection: row.connectionId
      ? { connectionId: row.connectionId, providerMerchantId: row.providerMerchantId ?? null }
      : null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class FileCommerceRepository implements CommerceRepository {
  readonly backend = 'file' as const;

  async getTenantPolicy(tenantId: string): Promise<OpsTenantPolicy> {
    const store = await readStore();
    const tenant = store.tenants.find((item) => item.id === tenantId) ?? null;
    if (!tenant) {
      throw new CommerceError('unknown-item', 'Shop not found.');
    }
    return {
      orderReviewRequired: tenant.orderReviewRequired ?? true,
      timezone: tenant.timezone || 'UTC',
      currencyCode: tenant.currencyCode || 'KES',
      slug: tenant.slug,
      name: tenant.name,
    };
  }

  async getCatalogProducts(tenantId: string): Promise<OpsCatalogProduct[]> {
    const store = await readStore();
    return store.products
      .filter((product) => product.tenantId === tenantId)
      .map((product) => ({
        id: product.id,
        tenantId: product.tenantId,
        name: product.name,
        sellingPrice: product.sellingPrice ?? null,
        unitCost: product.unitCost,
        sku: product.sku ?? null,
        quantityOnHand: product.quantityOnHand ?? 0,
        reorderLevel: product.reorderLevel ?? null,
        criticalLevel: product.criticalLevel ?? null,
        isActive: product.isActive,
      }));
  }

  async getCatalogServices(tenantId: string): Promise<OpsCatalogService[]> {
    const store = await readStore();
    return store.services
      .filter((service) => service.tenantId === tenantId)
      .map((service) => ({
        id: service.id,
        tenantId: service.tenantId,
        name: service.name,
        price: service.price,
        durationMinutes: service.durationMinutes,
        commissionType: service.commissionType,
        commissionValue: service.commissionValue,
        isActive: service.isActive,
      }));
  }

  async getProductBalance(tenantId: string, productId: string): Promise<number> {
    const store = await readStore();
    const product = store.products.find((item) => item.id === productId && item.tenantId === tenantId) ?? null;
    if (!product) {
      throw new CommerceError('unknown-item', 'Product not found for this shop.');
    }
    return product.quantityOnHand ?? 0;
  }

  async createOrder(input: Parameters<CommerceRepository['createOrder']>[0], ctx: OpContext = {}) {
    void ctx;
    return updateStore((store) => createOrderOp(asCommerceStore(store), input));
  }

  async submitOrder(
    input: { tenantId: string; orderId: string; actorId: string; actorRole: 'shop_admin' | 'staff' | 'super_admin' | 'customer' | 'system'; orderReviewRequired: boolean; forceReview?: boolean },
    ctx: OpContext = {},
  ) {
    void ctx;
    return updateStore((store) => submitOrderOp(asCommerceStore(store), input));
  }

  async approveOrder(
    input: { tenantId: string; orderId: string; actorId: string; actorRole: 'shop_admin' | 'staff' | 'super_admin' | 'customer' | 'system' },
    ctx: OpContext = {},
  ) {
    return updateStore((store) => {
      const result = approveOrderOp(asCommerceStore(store), input);
      // Same mutator: the legacy statistics projection commits with the sale.
      if (!result.duplicate) {
        projectFreshSaleToLegacy(store, result.sale, input.actorId, ctx);
      }
      return result;
    });
  }

  async finalizeApprovedOrder(
    input: { tenantId: string; orderId: string; actorId: string },
    ctx: OpContext = {},
  ) {
    return updateStore((store) => {
      const result = finalizeApprovedOrderOp(asCommerceStore(store), input);
      // Same mutator: the legacy statistics projection commits with the sale.
      if (!result.duplicate) {
        projectFreshSaleToLegacy(store, result.sale, input.actorId, ctx);
      }
      return result;
    });
  }

  async rejectOrder(
    input: { tenantId: string; orderId: string; actorId: string; actorRole: 'shop_admin' | 'staff' | 'super_admin' | 'customer' | 'system'; reason?: string | null },
    ctx: OpContext = {},
  ) {
    void ctx;
    return updateStore((store) => rejectOrderOp(asCommerceStore(store), input));
  }

  async cancelOrder(input: { tenantId: string; orderId: string }, ctx: OpContext = {}) {
    void ctx;
    return updateStore((store) => cancelOrderOp(asCommerceStore(store), input));
  }

  async voidSale(
    input: { tenantId: string; saleId: string; actorId: string; actorRole: 'shop_admin' | 'staff' | 'super_admin' | 'customer' | 'system'; reason?: string | null },
    ctx: OpContext = {},
  ) {
    void ctx;
    return updateStore((store) => {
      const result = voidSaleOp(asCommerceStore(store), input);
      // Co-written legacy rows follow the engine void (same mutator),
      // including linked-booking restoration inside voidServiceRecord.
      for (const record of store.serviceRecords) {
        if (record.tenantId === input.tenantId && record.commerceSaleId === result.sale.id && !record.voidedAt) {
          voidServiceRecord(store, {
            tenantId: input.tenantId,
            recordId: record.id,
            userId: input.actorId,
            reason: input.reason?.trim() || 'Sale voided.',
          });
        }
      }
      return result;
    });
  }

  async getOrderWithItems(tenantId: string, orderId: string) {
    const store = await readStore();
    const order = (store.orders ?? []).find((item) => item.id === orderId && item.tenantId === tenantId) ?? null;
    if (!order) {
      return null;
    }
    const items = (store.orderItems ?? []).filter((item) => item.orderId === orderId && item.tenantId === tenantId);
    return { order: order as unknown as OpsOrder, items: items as unknown as OpsOrderItem[] };
  }

  async getSaleWithItems(tenantId: string, saleId: string) {
    const store = await readStore();
    const sale = (store.sales ?? []).find((item) => item.id === saleId && item.tenantId === tenantId) ?? null;
    if (!sale) {
      return null;
    }
    const items = (store.saleItems ?? []).filter((item) => item.saleId === saleId && item.tenantId === tenantId);
    return { sale: sale as unknown as OpsSale, items: items as unknown as OpsSaleItem[] };
  }

  async postInventoryMovement(input: PostMovementInput, ctx: OpContext = {}) {
    void ctx;
    return updateStore((store) =>
      postInventoryMovementOp(
        store as unknown as Parameters<typeof postInventoryMovementOp>[0],
        input,
      ),
    ) as Promise<OpsMovement>;
  }

  async postOpeningBalance(
    input: Omit<PostMovementInput, 'type' | 'quantity'> & { quantity: number },
    ctx: OpContext = {},
  ) {
    void ctx;
    return updateStore((store) =>
      postOpeningBalanceOp(store as unknown as Parameters<typeof postOpeningBalanceOp>[0], input),
    ) as Promise<OpsMovement>;
  }

  async adjustProductStock(
    input: { tenantId: string; productId: string; countedQuantity: number; reason?: string | null; createdBy?: string | null },
    ctx: OpContext = {},
  ) {
    void ctx;
    return updateStore((store) =>
      adjustProductStockOp(store as unknown as Parameters<typeof adjustProductStockOp>[0], input),
    ) as Promise<OpsMovement>;
  }

  async consumeServiceBom(
    tenantId: string,
    serviceId: string,
    times: number,
    reference: { referenceType: string; referenceId: string; createdBy?: string | null },
  ): Promise<OpsMovement[]> {
    return updateStore((store) =>
      consumeServiceBomOp(store as unknown as Parameters<typeof consumeServiceBomOp>[0], {
        tenantId,
        serviceId,
        times,
        referenceType: reference.referenceType,
        referenceId: reference.referenceId,
        createdBy: reference.createdBy ?? null,
      }),
    ) as Promise<OpsMovement[]>;
  }

  async createPayment(input: CreatePaymentInput, ctx: OpContext = {}) {
    void ctx;
    return updateStore((store) => {
      const now = ctx.now ?? new Date().toISOString();
      const existing = input.idempotencyKey
        ? (store.payments ?? []).find((item) => item.tenantId === input.tenantId && item.idempotencyKey === input.idempotencyKey) ?? null
        : null;
      if (existing) {
        return { payment: toOpsPayment(existing), duplicate: true };
      }
      const row = {
        id: ctx.generateId ? ctx.generateId() : randomUUID(),
        tenantId: input.tenantId,
        orderId: input.orderId ?? null,
        saleId: input.saleId ?? null,
        provider: input.provider,
        method: input.method,
        status: 'PENDING',
        amount: input.amount,
        currencyCode: input.currencyCode,
        customerPhone: input.customerPhone ?? null,
        providerReference: input.providerReference ?? null,
        providerRequestId: input.providerRequestId ?? null,
        idempotencyKey: input.idempotencyKey,
        attemptNumber: input.attemptNumber,
        initiatedAt: now,
        confirmedAt: null,
        failedAt: null,
        expiresAt: input.expiresAt ?? null,
        failureCode: null,
        failureReason: null,
        needsRecovery: false,
        recoveryReason: null,
        connectionId: input.connection?.connectionId ?? null,
        providerMerchantId: input.connection?.providerMerchantId ?? null,
        createdBy: input.createdBy ?? null,
        createdAt: now,
        updatedAt: now,
      };
      store.payments ??= [];
      store.payments.push(row);
      return { payment: toOpsPayment(row), duplicate: false };
    });
  }

  async transitionPayment(input: TransitionPaymentInput, ctx: OpContext = {}) {
    void ctx;
    return updateStore((store) => {
      const row = paymentRow(store, input.tenantId, input.paymentId);
      if (row.status !== 'PENDING') {
        // Convergent retry: an already-transitioned payment returns itself.
        return { payment: toOpsPayment(row), duplicate: true };
      }
      const now = ctx.now ?? new Date().toISOString();
      row.status = transitionPaymentStatus(row.status as 'PENDING', input.to);
      if (input.providerReference !== undefined) {
        row.providerReference = input.providerReference;
      }
      if (input.to === 'SUCCESS') {
        row.confirmedAt = now;
      } else {
        row.failedAt = now;
        row.failureCode = input.failureCode ?? null;
        row.failureReason = input.failureReason ?? null;
      }
      row.updatedAt = now;
      return { payment: toOpsPayment(row), duplicate: false };
    });
  }

  async getPaymentByIdempotency(tenantId: string, key: string) {
    const store = await readStore();
    const row = (store.payments ?? []).find((item) => item.tenantId === tenantId && item.idempotencyKey === key) ?? null;
    return row ? toOpsPayment(row) : null;
  }

  async getPaymentByProviderRequest(tenantId: string, providerRequestId: string) {
    const store = await readStore();
    const row = (store.payments ?? []).find(
      (item) => item.tenantId === tenantId && item.providerRequestId === providerRequestId,
    ) ?? null;
    return row ? toOpsPayment(row) : null;
  }

  async getPaymentByProviderRequestGlobal(providerRequestId: string) {
    const store = await readStore();
    const row = (store.payments ?? []).find((item) => item.providerRequestId === providerRequestId) ?? null;
    return row ? toOpsPayment(row) : null;
  }

  async getPaymentsByOrder(tenantId: string, orderId: string) {
    const store = await readStore();
    return (store.payments ?? [])
      .filter((item) => item.tenantId === tenantId && item.orderId === orderId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toOpsPayment);
  }

  async markPaymentRecovery(tenantId: string, paymentId: string, reason: string, ctx: OpContext = {}) {
    void ctx;
    return updateStore((store) => {
      const row = paymentRow(store, tenantId, paymentId);
      row.needsRecovery = true;
      row.recoveryReason = reason;
      row.updatedAt = ctx.now ?? new Date().toISOString();
      return toOpsPayment(row);
    });
  }

  // ── payment connections (Phase 4B) ──

  async getConnectionById(tenantId: string, connectionId: string) {
    const store = await readStore();
    const row = (store.paymentConnections ?? []).find((item) => item.tenantId === tenantId && item.id === connectionId) ?? null;
    return row ? toOpsConnection(row) : null;
  }

  async getActiveConnection(tenantId: string, environment?: PaymentConnectionEnvironment) {
    const store = await readStore();
    const row = (store.paymentConnections ?? []).find(
      (item) =>
        item.tenantId === tenantId &&
        item.status === 'CONNECTED' &&
        (!environment || item.environment === environment),
    ) ?? null;
    return row ? toOpsConnection(row) : null;
  }

  async listConnections(tenantId: string) {
    const store = await readStore();
    return (store.paymentConnections ?? [])
      .filter((item) => item.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toOpsConnection);
  }

  async findConnectionByProviderTenantId(providerTenantId: string) {
    const store = await readStore();
    const row = (store.paymentConnections ?? []).find((item) => item.providerTenantId === providerTenantId) ?? null;
    return row ? toOpsConnection(row) : null;
  }

  async createConnection(
    input: {
      tenantId: string;
      provider: PaymentConnectionProvider;
      providerTenantId: string;
      environment: PaymentConnectionEnvironment;
      status: PaymentConnectionStatus;
      displayName?: string | null;
      supportedMethods: PaymentConnectionMethod[];
      secretSealed: string | null;
      webhookSecretSealed: string | null;
      connectedAt?: string | null;
      lastVerifiedAt?: string | null;
    },
    ctx: OpContext = {},
  ) {
    void ctx;
    return updateStore((store) => {
      const now = ctx.now ?? new Date().toISOString();
      const row: StorePaymentConnection = {
        id: ctx.generateId ? ctx.generateId() : randomUUID(),
        tenantId: input.tenantId,
        provider: input.provider,
        providerTenantId: input.providerTenantId,
        environment: input.environment,
        status: input.status,
        displayName: input.displayName ?? null,
        supportedMethods: [...input.supportedMethods],
        connectedAt: input.connectedAt ?? null,
        lastVerifiedAt: input.lastVerifiedAt ?? null,
        disconnectedAt: null,
        lastCheckCode: null,
        lastCheckMessage: null,
        secretSealed: input.secretSealed,
        webhookSecretSealed: input.webhookSecretSealed,
        createdAt: now,
        updatedAt: now,
      };
      store.paymentConnections ??= [];
      store.paymentConnections.push(row);
      return toOpsConnection(row);
    });
  }

  async updateConnection(
    input: {
      tenantId: string;
      connectionId: string;
      status?: PaymentConnectionStatus;
      displayName?: string | null;
      supportedMethods?: PaymentConnectionMethod[];
      secretSealed?: string | null;
      webhookSecretSealed?: string | null;
      connectedAt?: string | null;
      lastVerifiedAt?: string | null;
      disconnectedAt?: string | null;
      lastCheckCode?: string | null;
      lastCheckMessage?: string | null;
    },
    ctx: OpContext = {},
  ) {
    void ctx;
    return updateStore((store) => {
      const row = (store.paymentConnections ?? []).find(
        (item) => item.tenantId === input.tenantId && item.id === input.connectionId,
      ) ?? null;
      if (!row) {
        throw new PaymentConnectionError('connection-not-found', 'Payment connection not found for this shop.');
      }
      const now = ctx.now ?? new Date().toISOString();
      if (input.status !== undefined) row.status = input.status;
      if (input.displayName !== undefined) row.displayName = input.displayName;
      if (input.supportedMethods !== undefined) row.supportedMethods = [...input.supportedMethods];
      if (input.secretSealed !== undefined) row.secretSealed = input.secretSealed;
      if (input.webhookSecretSealed !== undefined) row.webhookSecretSealed = input.webhookSecretSealed;
      if (input.connectedAt !== undefined) row.connectedAt = input.connectedAt;
      if (input.lastVerifiedAt !== undefined) row.lastVerifiedAt = input.lastVerifiedAt;
      if (input.disconnectedAt !== undefined) row.disconnectedAt = input.disconnectedAt;
      if (input.lastCheckCode !== undefined) row.lastCheckCode = input.lastCheckCode;
      if (input.lastCheckMessage !== undefined) row.lastCheckMessage = input.lastCheckMessage;
      row.updatedAt = now;
      return toOpsConnection(row);
    });
  }

  async recordConnectionEvent(
    input: {
      tenantId: string;
      connectionId?: string | null;
      action: PaymentConnectionEventAction;
      actorId?: string | null;
      actorRole?: string | null;
      result?: 'OK' | 'ERROR';
      oldProviderReference?: string | null;
      newProviderReference?: string | null;
    },
    ctx: OpContext = {},
  ) {
    void ctx;
    return updateStore((store) => {
      const now = ctx.now ?? new Date().toISOString();
      const row: StoreConnectionEvent = {
        id: ctx.generateId ? ctx.generateId() : randomUUID(),
        tenantId: input.tenantId,
        connectionId: input.connectionId ?? null,
        action: input.action as string,
        actorId: input.actorId ?? null,
        actorRole: input.actorRole ?? null,
        result: (input.result ?? 'OK') as string,
        oldProviderReference: input.oldProviderReference ?? null,
        newProviderReference: input.newProviderReference ?? null,
        createdAt: now,
      };
      store.connectionEvents ??= [];
      store.connectionEvents.push(row);
      return toOpsConnectionEvent(row);
    });
  }

  async listConnectionEvents(tenantId: string, filters: { connectionId?: string; limit?: number } = {}) {
    const store = await readStore();
    return (store.connectionEvents ?? [])
      .filter((item) => item.tenantId === tenantId)
      .filter((item) => !filters.connectionId || item.connectionId === filters.connectionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, filters.limit ?? 100)
      .map(toOpsConnectionEvent);
  }

  async listAllConnectionsForAudit() {
    const store = await readStore();
    return (store.paymentConnections ?? []).map(toOpsConnection);
  }

  async amendSale(
    input: {
      tenantId: string;
      saleId: string;
      corrected: {
        price: number;
        serviceId: string | null;
        serviceName: string;
        commissionType: 'fixed' | 'percentage';
        commissionValue: number;
        commissionAmount: number;
      };
      actorId: string;
      reason?: string | null;
    },
    ctx: OpContext = {},
  ) {
    void ctx;
    return updateStore((store) => {
      const commerce = asCommerceStore(store);
      const reason = (input.reason ?? '').trim();
      if (!reason) {
        throw new CommerceError('amendment-reason-required', 'Corrections to linked sales need a reason.');
      }
      const sale = (store.sales ?? []).find((item) => item.id === input.saleId && item.tenantId === input.tenantId) ?? null;
      if (!sale) {
        throw new CommerceError('unknown-item', 'Sale not found for this shop.');
      }
      if (sale.status !== 'COMPLETED') {
        throw new CommerceError('invalid-transition', 'Only completed sales can be amended.');
      }
      const items = (store.saleItems ?? []).filter((item) => item.saleId === sale.id && item.tenantId === input.tenantId);
      if (items.length !== 1 || items[0].itemType !== 'SERVICE') {
        throw new CommerceError('invalid-transition', 'That engine sale has unexpected lines for amendment.');
      }
      const item = items[0];
      const now = ctx.now ?? new Date().toISOString();
      const fieldChanges: { field: string; previous: unknown; current: unknown }[] = [];
      const track = (field: string, previous: unknown, current: unknown) => {
        if (JSON.stringify(previous) !== JSON.stringify(current)) {
          fieldChanges.push({ field, previous, current });
        }
      };
      const previousTotal = sale.total;
      track('actualUnitPrice', item.actualUnitPrice, input.corrected.price);
      track('commissionAmount', item.commissionAmount, input.corrected.commissionAmount);

      let stockSynced = false;
      if ((item.serviceId ?? null) !== (input.corrected.serviceId ?? null)) {
        const links = (store.serviceProductLinks ?? []).map((link) => ({
          serviceId: link.serviceId,
          tenantId: link.tenantId,
          productId: link.productId,
          quantity: link.quantity,
        }));
        const consumed = ((item.itemSnapshot ?? {}) as Record<string, unknown>).consumedProducts as { productId: string; quantity: number }[] | undefined ?? [];
        const { resolveServiceConsumption } = require('@/server/commerce/inventory') as typeof import('@/server/commerce/inventory');
        const { applyMovement } = require('@/server/commerce/inventory') as typeof import('@/server/commerce/inventory');
        const fresh = resolveServiceConsumption(links, input.tenantId, input.corrected.serviceId ?? '', item.quantity);
        for (const line of fresh) {
          const product = store.products.find((p) => p.id === line.productId && p.tenantId === input.tenantId) ?? null;
          const onHand = product?.quantityOnHand ?? 0;
          if (!product || (!ctx.allowNegative && onHand - line.quantity < 0)) {
            throw new CommerceError('insufficient-stock', 'Insufficient stock to restate this sale to the new service. Nothing was changed.');
          }
          void applyMovement;
        }
        track('serviceId', item.serviceId, input.corrected.serviceId);
        for (const line of consumed) {
          const product = store.products.find((p) => p.id === line.productId && p.tenantId === input.tenantId) ?? null;
          if (!product) {
            throw new CommerceError('unknown-item', 'A product required by this correction is missing.');
          }
          const app = applyMovement(product.quantityOnHand ?? 0, { type: 'ADJUSTMENT', quantity: line.quantity }, { allowNegative: true });
          const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
          store.inventoryMovements ??= [];
          store.inventoryMovements.push({
            id: ctx.generateId ? ctx.generateId() : randomUUID(),
            tenantId: sale.tenantId,
            productId: line.productId,
            quantity: line.quantity,
            movementType: 'ADJUSTMENT',
            referenceType: 'sale_correction',
            referenceId: sale.id,
            unitCost: product.unitCost ?? null,
            previousQuantity: app.previousQuantity,
            resultingQuantity: app.resultingQuantity,
            reason: `Correction restatement for sale ${sale.id}`,
            createdBy: input.actorId,
            createdAt: now,
          });
          product.quantityOnHand = app.resultingQuantity;
        }
        for (const line of fresh) {
          const product = store.products.find((p) => p.id === line.productId && p.tenantId === input.tenantId) ?? null;
          if (!product) {
            throw new CommerceError('unknown-item', 'A product required by this correction is missing.');
          }
          const app = applyMovement(product.quantityOnHand ?? 0, { type: 'SERVICE_CONSUMPTION', quantity: -line.quantity });
          const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
          store.inventoryMovements ??= [];
          store.inventoryMovements.push({
            id: ctx.generateId ? ctx.generateId() : randomUUID(),
            tenantId: sale.tenantId,
            productId: line.productId,
            quantity: -line.quantity,
            movementType: 'SERVICE_CONSUMPTION',
            referenceType: 'sale_correction',
            referenceId: sale.id,
            unitCost: product.unitCost ?? null,
            previousQuantity: app.previousQuantity,
            resultingQuantity: app.resultingQuantity,
            reason: null,
            createdBy: input.actorId,
            createdAt: now,
          });
          product.quantityOnHand = app.resultingQuantity;
        }
        item.serviceId = input.corrected.serviceId;
        item.itemName = input.corrected.serviceName;
        const correctedService = input.corrected.serviceId
          ? store.services.find((s) => s.id === input.corrected.serviceId && s.tenantId === input.tenantId) ?? null
          : null;
        item.itemSnapshot = {
          ...((item.itemSnapshot ?? {}) as Record<string, unknown>),
          durationMinutes: (correctedService as { durationMinutes?: number } | null)?.durationMinutes ?? (item.itemSnapshot as Record<string, unknown>).durationMinutes ?? null,
          consumedProducts: fresh,
        };
        stockSynced = true;
      }

      item.actualUnitPrice = input.corrected.price;
      item.lineTotal = input.corrected.price * item.quantity;
      item.commissionType = input.corrected.commissionType;
      item.commissionValue = input.corrected.commissionValue;
      item.commissionAmount = input.corrected.commissionAmount;

      sale.subtotal = (store.saleItems ?? [])
        .filter((entry) => entry.saleId === sale.id && entry.tenantId === sale.tenantId)
        .reduce((sum, entry) => sum + entry.lineTotal, 0);
      sale.total = sale.subtotal;
      sale.updatedAt = now;
      track('total', previousTotal, sale.total);

      const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
      store.saleAmendments ??= [];
      store.saleAmendments.push({
        id: ctx.generateId ? ctx.generateId() : randomUUID(),
        tenantId: input.tenantId,
        saleId: sale.id,
        previousTotal,
        newTotal: sale.total,
        fieldChanges,
        reason,
        actorId: input.actorId,
        createdAt: now,
      });

      return { amended: true, sale: sale as unknown as OpsSale, stockSynced };
    });
  }

  async getPaymentByIdGlobal(paymentId: string) {
    const store = await readStore();
    const row = (store.payments ?? []).find((item) => item.id === paymentId) ?? null;
    return row ? toOpsPayment(row) : null;
  }

  async updatePaymentProviderDetails(
    input: { tenantId: string; paymentId: string; providerRequestId?: string | null; providerReference?: string | null; expiresAt?: string | null },
    ctx: OpContext = {},
  ) {
    void ctx;
    return updateStore((store) => {
      const row = paymentRow(store, input.tenantId, input.paymentId);
      if (input.providerRequestId !== undefined) {
        row.providerRequestId = input.providerRequestId;
      }
      if (input.providerReference !== undefined) {
        row.providerReference = input.providerReference;
      }
      if (input.expiresAt !== undefined) {
        row.expiresAt = input.expiresAt;
      }
      row.updatedAt = ctx.now ?? new Date().toISOString();
      return toOpsPayment(row);
    });
  }

  async completePaidOrder(
    input: { tenantId: string; orderId: string; paymentId: string; actorId: string },
    ctx: OpContext = {},
  ) {
    void ctx;
    try {
      return await updateStore((store) => {
        const commerce = asCommerceStore(store);
        const payment = paymentRow(store, input.tenantId, input.paymentId);
        if (payment.status !== 'SUCCESS') {
          throw new CommerceError('invalid-transition', 'Payment is not confirmed.');
        }
        const order = (store.orders ?? []).find((item) => item.id === input.orderId && item.tenantId === input.tenantId) ?? null;
        if (!order) {
          throw new CommerceError('unknown-item', 'Order not found for this shop.');
        }
        if (order.status === 'PENDING_REVIEW' || order.status === 'SUBMITTED') {
          order.status = 'APPROVED';
          order.approvedAt = ctx.now ?? new Date().toISOString();
          order.approvedBy = input.actorId;
          order.updatedAt = order.approvedAt;
        }
        const finalized = finalizeApprovedOrderOp(commerce, {
          tenantId: input.tenantId,
          orderId: input.orderId,
          actorId: input.actorId,
        });
        // Same mutator: the legacy statistics projection commits with the sale.
        if (!finalized.duplicate) {
          projectFreshSaleToLegacy(store, finalized.sale, input.actorId, ctx);
        }
        payment.saleId = finalized.sale.id;
        payment.needsRecovery = false;
        payment.recoveryReason = null;
        payment.updatedAt = ctx.now ?? new Date().toISOString();
        return {
          order: finalized.order,
          sale: finalized.sale,
          payment: toOpsPayment(payment),
          outcome: 'completed' as const,
        };
      });
    } catch (error) {
      if (error instanceof CommerceError && error.code === 'insufficient-stock') {
        const payment = await updateStore((store) => {
          const row = paymentRow(store, input.tenantId, input.paymentId);
          row.needsRecovery = true;
          row.recoveryReason = `Stock unavailable at finalization for order ${input.orderId}.`;
          row.updatedAt = ctx.now ?? new Date().toISOString();
          return toOpsPayment(row);
        });
        const store = await readStore();
        const order = (store.orders ?? []).find((item) => item.id === input.orderId && item.tenantId === input.tenantId);
        const sale = (store.sales ?? []).find((item) => item.orderId === input.orderId && item.tenantId === input.tenantId);
        return {
          order: order as unknown as OpsOrder,
          sale: sale as unknown as OpsSale,
          payment,
          outcome: 'needs-recovery' as const,
        };
      }
      throw error;
    }
  }

  async recoverPaidOrder(
    input: { tenantId: string; paymentId: string; actorId: string },
    ctx: OpContext = {},
  ) {
    void ctx;
    const store = await readStore();
    const payment = paymentRow(store, input.tenantId, input.paymentId);
    if (payment.status !== 'SUCCESS' || !payment.needsRecovery) {
      throw new CommerceError('invalid-transition', 'That payment does not need recovery.');
    }
    if (!payment.orderId) {
      throw new CommerceError('unknown-item', 'Recoverable payment has no order.');
    }
    return this.completePaidOrder({ tenantId: input.tenantId, orderId: payment.orderId, paymentId: payment.id, actorId: input.actorId }, ctx);
  }

  async verifySellerCredential(tenantId: string, reference: unknown, bearer: unknown, ctx: OpContext = {}) {
    void ctx;
    const store = await readStore();
    const context = verifySellerCredentialOp(asSellerStore(store), { tenantId, reference, bearer });
    const seller = store.users.find((item) => item.id === context.sellerId) ?? null;
    return { ...context, sellerName: seller?.fullName ?? null };
  }

  async resolveSellerCredentialTenant(reference: string) {
    const store = await readStore();
    const row = (store.sellerCredentials ?? []).find((item) => item.publicReference === reference) ?? null;
    return row ? row.tenantId : null;
  }

  async touchSellerCredentialUsed(tenantId: string, credentialId: string, ctx: OpContext = {}) {
    void ctx;
    await updateStore((store) => {
      touchSellerCredentialUsed(asSellerStore(store), { tenantId, credentialId });
    });
  }

  async getOrderView(tenantId: string, orderId: string): Promise<OrderView | null> {
    const store = await readStore();
    const order = (store.orders ?? []).find((item) => item.id === orderId && item.tenantId === tenantId) ?? null;
    return order ? orderFromStore(order, store.orderItems ?? [], store.users, store.customers) : null;
  }

  async getSaleView(tenantId: string, saleId: string): Promise<SaleView | null> {
    const store = await readStore();
    const sale = (store.sales ?? []).find((item) => item.id === saleId && item.tenantId === tenantId) ?? null;
    return sale
      ? saleFromStore(sale, store.saleItems ?? [], store.users, store.customers, store.orders ?? [])
      : null;
  }

  async listOrderViews(tenantId: string, filters: { sellerId?: string } = {}): Promise<OrderView[]> {
    const store = await readStore();
    return (store.orders ?? [])
      .filter((item) => item.tenantId === tenantId)
      .filter((item) => !filters.sellerId || item.sellerId === filters.sellerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((order) => orderFromStore(order, store.orderItems ?? [], store.users, store.customers));
  }

  async listSaleViews(tenantId: string, filters: { sellerId?: string } = {}): Promise<SaleView[]> {
    const store = await readStore();
    return (store.sales ?? [])
      .filter((item) => item.tenantId === tenantId)
      .filter((item) => !filters.sellerId || item.sellerId === filters.sellerId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((sale) => saleFromStore(sale, store.saleItems ?? [], store.users, store.customers, store.orders ?? []));
  }

  async getSellerSales(tenantId: string, sellerId: string) {
    const store = await readStore();
    const orders = (store.orders ?? []).filter((item) => item.tenantId === tenantId && item.sellerId === sellerId);
    const sales = (store.sales ?? []).filter((item) => item.tenantId === tenantId && item.sellerId === sellerId);
    return {
      orders: orders as unknown as OpsOrder[],
      sales: sales as unknown as OpsSale[],
    };
  }

  async getAdminOrders(tenantId: string) {
    const store = await readStore();
    return (store.orders ?? []).filter((item) => item.tenantId === tenantId) as unknown as OpsOrder[];
  }

  async listPayments(
    tenantId: string,
    filters: { orderId?: string; status?: 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'CANCELLED'; needsRecovery?: boolean } = {},
  ) {
    const store = await readStore();
    return (store.payments ?? [])
      .filter((item) => item.tenantId === tenantId)
      .filter((item) => !filters.orderId || item.orderId === filters.orderId)
      .filter((item) => !filters.status || item.status === filters.status)
      .filter((item) => filters.needsRecovery === undefined || (item.needsRecovery ?? false) === filters.needsRecovery)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toOpsPayment);
  }
}
