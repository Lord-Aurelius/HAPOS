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
import {
  amendEngineSaleForCorrection,
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
import {
  touchSellerCredentialUsed,
  verifySellerCredential as verifySellerCredentialOp,
} from '@/server/commerce/seller-store';
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
import type { StoreState } from '@/server/store/types';

function asCommerceStore(store: StoreState): CommerceStore {
  return store as unknown as CommerceStore;
}

function asSellerStore(store: StoreState): Parameters<typeof verifySellerCredentialOp>[0] {
  return store as unknown as Parameters<typeof verifySellerCredentialOp>[0];
}

function paymentRow(store: StoreState, tenantId: string, paymentId: string) {
  const payment = (store.payments ?? []).find((item) => item.id === paymentId && item.tenantId === tenantId) ?? null;
  if (!payment) {
    throw new PaymentError('unknown-payment', 'Payment not found for this shop.');
  }
  return payment;
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
    void ctx;
    return updateStore((store) => approveOrderOp(asCommerceStore(store), input));
  }

  async finalizeApprovedOrder(
    input: { tenantId: string; orderId: string; actorId: string },
    ctx: OpContext = {},
  ) {
    void ctx;
    return updateStore((store) => finalizeApprovedOrderOp(asCommerceStore(store), input));
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
    return updateStore((store) => voidSaleOp(asCommerceStore(store), input));
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
      // Resolve the linked legacy row (correction flows address it); engine-
      // native sales without one amend directly by sale id below.
      const linked = (store.serviceRecords ?? []).find(
        (item) => item.tenantId === input.tenantId && item.commerceSaleId === input.saleId,
      ) ?? null;
      if (!linked) {
        throw new CommerceError('unknown-item', 'No linked legacy record for that sale.');
      }
      return amendEngineSaleForCorrection(asCommerceStore(store), {
        tenantId: input.tenantId,
        legacyRecordId: linked.id,
        corrected: input.corrected,
        actorId: input.actorId,
        reason: input.reason ?? null,
      });
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
    return verifySellerCredentialOp(asSellerStore(store), { tenantId, reference, bearer });
  }

  async touchSellerCredentialUsed(tenantId: string, credentialId: string, ctx: OpContext = {}) {
    void ctx;
    await updateStore((store) => {
      touchSellerCredentialUsed(asSellerStore(store), { tenantId, credentialId });
    });
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
