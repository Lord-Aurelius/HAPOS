/**
 * Session-bound commerce service (Phase 2, unit 5).
 *
 * Single bridge between persistence ops (`commerce-store.ts`) and all
 * surfaces (server actions + REST routes). Views are built inside the
 * mutator (the `readStore` cache can lag `updateStore` within one request).
 */

import type { Order, OrderItem, Sale, SaleItem } from '@/lib/types';
import { normalizeIdempotencyKey, IdempotencyKeyError } from '@/server/commerce/idempotency';
import {
  approveOrder,
  cancelOrder,
  createOrder,
  finalizeApprovedOrder,
  rejectOrder,
  submitOrder,
  voidSale,
  type ActorRole,
  type CommerceStore,
} from '@/server/commerce/commerce-store';
import { CommerceError, type CartLineRequest, type OrderSource } from '@/server/commerce/orders';
import { InventoryError } from '@/server/commerce/inventory';
import { SaleValidationError } from '@/server/commerce/sale-validation';
import { getOrderById, getSaleById, listOrdersByTenant, listSalesByTenant, readStore, updateStore } from '@/server/store';
import { voidServiceRecord } from '@/server/store/service-records';
import type { StoreState } from '@/server/store/types';

export type CommerceSession = {
  tenantId: string;
  userId: string;
  userRole: 'shop_admin' | 'staff' | 'super_admin';
};

export type ServiceError = {
  status: 400 | 403 | 404;
  code: string;
  message: string;
};

export function toServiceError(error: unknown): ServiceError {
  if (error instanceof CommerceError) {
    if (error.code === 'not-permitted') {
      return { status: 403, code: error.code, message: error.message };
    }
    if (error.code === 'unknown-item') {
      return { status: 404, code: error.code, message: error.message };
    }
    return { status: 400, code: error.code, message: error.message };
  }
  if (error instanceof InventoryError) {
    return { status: 400, code: error.code, message: error.message };
  }
  if (error instanceof SaleValidationError) {
    return { status: 400, code: error.code, message: error.message };
  }
  if (error instanceof IdempotencyKeyError) {
    return { status: 400, code: 'invalid-idempotency-key', message: error.message };
  }
  throw error;
}

function actorRoleOf(session: CommerceSession): ActorRole {
  return session.userRole;
}

/** Parse + coerce client cart lines. Rejects malformed shapes with 400 codes. */
export function parseCartLines(raw: unknown): CartLineRequest[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new CommerceError('empty-order', 'An order needs at least one product or service line.');
  }
  return raw.map((entry) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    if (record.kind !== 'product' && record.kind !== 'service') {
      throw new CommerceError('unknown-item', 'Each order line must be a product or a service.');
    }
    if (typeof record.refId !== 'string' || !record.refId.trim()) {
      throw new CommerceError('unknown-item', 'Each order line needs a catalog reference.');
    }
    const quantity = typeof record.quantity === 'number' ? record.quantity : Number(record.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new CommerceError('invalid-quantity', 'Each order line needs a positive whole-number quantity.');
    }
    let actualUnitPrice: number | null = null;
    if (record.actualUnitPrice !== undefined && record.actualUnitPrice !== null && String(record.actualUnitPrice).trim() !== '') {
      const parsed = typeof record.actualUnitPrice === 'number' ? record.actualUnitPrice : Number(record.actualUnitPrice);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new CommerceError('invalid-price', 'Actual unit prices must be valid amounts of zero or more.');
      }
      actualUnitPrice = parsed;
    }
    return {
      kind: record.kind,
      refId: record.refId.trim(),
      quantity,
      actualUnitPrice,
      overrideReason: typeof record.overrideReason === 'string' ? record.overrideReason : null,
    };
  });
}

function storeAsCommerceStore(store: StoreState): CommerceStore {
  return store as unknown as CommerceStore;
}

function enrichOrderItems(store: StoreState, orderId: string, tenantId: string): OrderItem[] {
  return (store.orderItems ?? [])
    .filter((item) => item.orderId === orderId && item.tenantId === tenantId)
    .map((item) => ({
      id: item.id,
      tenantId: item.tenantId,
      orderId: item.orderId,
      itemType: item.itemType,
      productId: item.productId ?? null,
      serviceId: item.serviceId ?? null,
      quantity: item.quantity,
      catalogUnitPrice: item.catalogUnitPrice,
      actualUnitPrice: item.actualUnitPrice,
      lineTotal: item.lineTotal,
      itemName: item.itemName,
      commissionType: item.commissionType ?? 'percentage',
      commissionValue: item.commissionValue ?? 0,
      commissionAmount: item.commissionAmount ?? 0,
      overrideReason: item.overrideReason ?? null,
    }));
}

function enrichOrder(store: StoreState, orderId: string, tenantId: string): Order {
  const order = (store.orders ?? []).find((item) => item.id === orderId && item.tenantId === tenantId);
  if (!order) {
    throw new CommerceError('unknown-item', 'Order not found for this shop.');
  }
  return {
    id: order.id,
    tenantId: order.tenantId,
    customerId: order.customerId ?? null,
    customerName: order.customerId
      ? store.customers.find((item) => item.id === order.customerId)?.name ?? null
      : null,
    sellerId: order.sellerId ?? null,
    sellerName: order.sellerId
      ? store.users.find((item) => item.id === order.sellerId)?.fullName ?? null
      : null,
    status: order.status as Order['status'],
    subtotal: order.subtotal,
    total: order.total,
    currencyCode: order.currencyCode,
    source: order.source,
    notes: order.notes ?? null,
    items: enrichOrderItems(store, order.id, tenantId),
    submittedAt: order.submittedAt ?? null,
    approvedAt: order.approvedAt ?? null,
    completedAt: order.completedAt ?? null,
    createdAt: order.createdAt,
    sellerCredentialId: order.sellerCredentialId ?? null,
  };
}

function enrichSale(store: StoreState, saleId: string, tenantId: string): Sale {
  const sale = (store.sales ?? []).find((item) => item.id === saleId && item.tenantId === tenantId);
  if (!sale) {
    throw new CommerceError('unknown-item', 'Sale not found for this shop.');
  }
  const items: SaleItem[] = (store.saleItems ?? [])
    .filter((item) => item.saleId === sale.id && item.tenantId === tenantId)
    .map((item) => ({
      id: item.id,
      tenantId: item.tenantId,
      saleId: item.saleId,
      itemType: item.itemType,
      productId: item.productId ?? null,
      serviceId: item.serviceId ?? null,
      quantity: item.quantity,
      catalogUnitPrice: item.catalogUnitPrice,
      actualUnitPrice: item.actualUnitPrice,
      lineTotal: item.lineTotal,
      itemName: item.itemName,
      commissionType: item.commissionType ?? 'percentage',
      commissionValue: item.commissionValue ?? 0,
      commissionAmount: item.commissionAmount ?? 0,
      overrideReason: item.overrideReason ?? null,
      overrideHistoryUnknown: item.overrideHistoryUnknown ?? false,
    }));
  return {
    id: sale.id,
    tenantId: sale.tenantId,
    orderId: sale.orderId,
    customerId: sale.customerId ?? null,
    customerName: sale.customerId
      ? store.customers.find((item) => item.id === sale.customerId)?.name ?? null
      : null,
    sellerId: sale.sellerId ?? null,
    sellerName: sale.sellerId
      ? store.users.find((item) => item.id === sale.sellerId)?.fullName ?? null
      : null,
    status: sale.status as Sale['status'],
    subtotal: sale.subtotal,
    total: sale.total,
    currencyCode: sale.currencyCode,
    source: (store.orders ?? []).find((item) => item.id === sale.orderId && item.tenantId === tenantId)?.source ?? 'STAFF',
    items,
    completedAt: sale.completedAt ?? null,
    voidedAt: sale.voidedAt ?? null,
    voidReason: sale.voidReason ?? null,
    createdAt: sale.createdAt,
    sellerCredentialId: sale.sellerCredentialId ?? null,
  };
}

export type CreateCommerceOrderInput = {
  customerId?: string | null;
  lines: CartLineRequest[];
  clientTotal?: number | null;
  notes?: string | null;
  source?: OrderSource;
  idempotencyKey?: string | null;
};

export async function createAndSubmitOrder(
  session: CommerceSession,
  input: CreateCommerceOrderInput,
): Promise<{ order: Order; sale: Sale | null; route: 'PENDING_REVIEW' | 'AUTO_APPROVE'; duplicate: boolean }> {
  const key = normalizeIdempotencyKey(input.idempotencyKey ?? null);
  const source: OrderSource =
    input.source ?? (session.userRole === 'shop_admin' || session.userRole === 'super_admin' ? 'ADMIN' : 'STAFF');

  return updateStore((store) => {
    const commerce = storeAsCommerceStore(store);
    const tenant = store.tenants.find((item) => item.id === session.tenantId) ?? null;
    const policy = tenant?.orderReviewRequired ?? true;

    const created = createOrder(
      commerce,
      {
        tenantId: session.tenantId,
        customerId: input.customerId ?? null,
        sellerId: session.userId,
        source,
        notes: input.notes ?? null,
        lines: input.lines,
        clientTotal: input.clientTotal ?? null,
        idempotencyKey: key,
        creatorRole: actorRoleOf(session),
        creatorId: session.userId,
        orderReviewRequired: policy,
      },
    );

    if (created.duplicate) {
      return { order: enrichOrder(store, created.order.id, session.tenantId), sale: null, route: 'AUTO_APPROVE' as const, duplicate: true };
    }

    const submitted = submitOrder(
      commerce,
      {
        tenantId: session.tenantId,
        orderId: created.order.id,
        actorId: session.userId,
        actorRole: actorRoleOf(session),
        orderReviewRequired: policy,
      },
    );

    // Staff-speed path: an auto-approved order finalizes its sale in the SAME
    // mutator (atomic inventory). Review-routed orders wait for an admin.
    let sale: Sale | null = null;
    if (submitted.route === 'AUTO_APPROVE') {
      const finalized = finalizeApprovedOrder(commerce, {
        tenantId: session.tenantId,
        orderId: created.order.id,
        actorId: session.userId,
      });
      sale = enrichSale(store, finalized.sale.id, session.tenantId);
    }

    return { order: enrichOrder(store, created.order.id, session.tenantId), sale, route: submitted.route, duplicate: false };
  });
}

export async function submitCommerceOrder(
  session: CommerceSession,
  orderId: string,
): Promise<{ order: Order; route: 'PENDING_REVIEW' | 'AUTO_APPROVE' }> {
  return updateStore((store) => {
    const tenant = store.tenants.find((item) => item.id === session.tenantId) ?? null;
    const submitted = submitOrder(storeAsCommerceStore(store), {
      tenantId: session.tenantId,
      orderId,
      actorId: session.userId,
      actorRole: actorRoleOf(session),
      orderReviewRequired: tenant?.orderReviewRequired ?? true,
    });
    return { order: enrichOrder(store, orderId, session.tenantId), route: submitted.route };
  });
}

export async function approveCommerceOrder(
  session: CommerceSession,
  orderId: string,
): Promise<{ order: Order; sale: Sale; duplicate: boolean }> {
  return updateStore((store) => {
    const result = approveOrder(storeAsCommerceStore(store), {
      tenantId: session.tenantId,
      orderId,
      actorId: session.userId,
      actorRole: actorRoleOf(session),
    });
    return {
      order: enrichOrder(store, result.order.id, session.tenantId),
      sale: enrichSale(store, result.sale.id, session.tenantId),
      duplicate: result.duplicate,
    };
  });
}

export async function rejectCommerceOrder(
  session: CommerceSession,
  orderId: string,
  reason?: string | null,
): Promise<Order> {
  return updateStore((store) => {
    const order = rejectOrder(storeAsCommerceStore(store), {
      tenantId: session.tenantId,
      orderId,
      actorId: session.userId,
      actorRole: actorRoleOf(session),
      reason: reason ?? null,
    });
    return enrichOrder(store, order.id, session.tenantId);
  });
}

export async function cancelCommerceOrder(session: CommerceSession, orderId: string): Promise<Order> {
  return updateStore((store) => {
    const order = cancelOrder(storeAsCommerceStore(store), {
      tenantId: session.tenantId,
      orderId,
    });
    return enrichOrder(store, order.id, session.tenantId);
  });
}

export async function voidCommerceSale(
  session: CommerceSession,
  saleId: string,
  reason?: string | null,
): Promise<Sale> {
  return updateStore((store) => {
    const { sale } = voidSale(storeAsCommerceStore(store), {
      tenantId: session.tenantId,
      saleId,
      actorId: session.userId,
      actorRole: actorRoleOf(session),
      reason: reason ?? null,
    });
    // Phase 2: co-written legacy rows follow the engine void (same mutator),
    // including linked-booking restoration inside voidServiceRecord.
    for (const record of store.serviceRecords) {
      if (record.tenantId === session.tenantId && record.commerceSaleId === sale.id && !record.voidedAt) {
        voidServiceRecord(store, {
          tenantId: session.tenantId,
          recordId: record.id,
          userId: session.userId,
          reason: reason?.trim() || 'Sale voided.',
        });
      }
    }
    return enrichSale(store, sale.id, session.tenantId);
  });
}

export async function listCommerceOrders(session: CommerceSession, options: { ownOnly?: boolean } = {}): Promise<Order[]> {
  const orders = await listOrdersByTenant(session.tenantId);
  if (session.userRole === 'staff' || options.ownOnly) {
    return orders.filter((order) => order.sellerId === session.userId);
  }
  return orders;
}

export async function getCommerceOrder(session: CommerceSession, orderId: string): Promise<Order | null> {
  const order = await getOrderById(session.tenantId, orderId);
  if (!order) {
    return null;
  }
  if (session.userRole === 'staff' && order.sellerId !== session.userId) {
    return null;
  }
  return order;
}

export async function listCommerceSales(session: CommerceSession, options: { ownOnly?: boolean } = {}): Promise<Sale[]> {
  const sales = await listSalesByTenant(session.tenantId);
  if (session.userRole === 'staff' || options.ownOnly) {
    return sales.filter((sale) => sale.sellerId === session.userId);
  }
  return sales;
}

export async function getCommerceSale(session: CommerceSession, saleId: string): Promise<Sale | null> {
  const sale = await getSaleById(session.tenantId, saleId);
  if (!sale) {
    return null;
  }
  if (session.userRole === 'staff' && sale.sellerId !== session.userId) {
    return null;
  }
  return sale;
}

export async function getTenantPolicy(tenantId: string): Promise<{ orderReviewRequired: boolean }> {
  const store = await readStore();
  const tenant = store.tenants.find((item) => item.id === tenantId) ?? null;
  return { orderReviewRequired: tenant?.orderReviewRequired ?? true };
}
