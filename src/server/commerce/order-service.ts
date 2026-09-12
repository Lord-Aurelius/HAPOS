/**
 * Session-bound commerce service (Phase 4: repository cutover).
 *
 * Single bridge between the CommerceRepository interface and all surfaces
 * (server actions + REST routes). Works identically in file mode (file
 * adapter) and SQL mode (relational adapter): backend differences live
 * below this layer. Legacy salon flows in hapos.ts still use file ops
 * directly and are documented as remaining transitional.
 */

import type { Order, Sale } from '@/lib/types';
import { normalizeIdempotencyKey, IdempotencyKeyError } from '@/server/commerce/idempotency';
import { CartFormError } from '@/server/commerce/cart-form';
import { CommerceError, type CartLineRequest, type OrderSource } from '@/server/commerce/orders';
import { InventoryError } from '@/server/commerce/inventory';
import { SaleValidationError } from '@/server/commerce/sale-validation';
import { PaymentError } from '@/server/commerce/payments';
import { GatewayError } from '@/server/payments/gateway';
import { recordCashPayment } from '@/server/payments/payment-service';
import { getCommerceRepository } from '@/server/commerce/repository-select';
import type { ActorRole } from '@/server/commerce/commerce-store';

export type CommerceSession = {
  tenantId: string;
  userId: string;
  userRole: 'shop_admin' | 'staff' | 'super_admin';
};

export type ServiceError = {
  status: 400 | 401 | 403 | 404 | 502 | 503 | 504;
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
  if (error instanceof CartFormError) {
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
  if (error instanceof PaymentError) {
    if (error.code === 'unknown-payment') {
      return { status: 404, code: error.code, message: error.message };
    }
    return { status: 400, code: error.code, message: error.message };
  }
  if (error instanceof GatewayError) {
    if (error.code === 'callback-unauthenticated') {
      return { status: 401, code: error.code, message: error.message };
    }
    if (error.code === 'gateway-timeout') {
      return { status: 504, code: error.code, message: error.message };
    }
    if (error.code === 'gateway-unconfigured' || error.code === 'mock-forbidden') {
      return { status: 503, code: error.code, message: error.message };
    }
    return { status: 502, code: error.code, message: error.message };
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

export type CreateCommerceOrderInput = {
  customerId?: string | null;
  lines: CartLineRequest[];
  clientTotal?: number | null;
  notes?: string | null;
  source?: OrderSource;
  idempotencyKey?: string | null;
  /** Phase 3: QR credential attribution (validated by the ops layer). */
  sellerCredentialId?: string | null;
  /** Phase 4 payment intent. Absent means CASH (immediate completion). */
  paymentMethod?: string | null;
  customerPhone?: string | null;
};

async function requireOrderView(repo: ReturnType<typeof getCommerceRepository>, tenantId: string, orderId: string): Promise<Order> {
  const order = await repo.getOrderView(tenantId, orderId);
  if (!order) {
    throw new CommerceError('unknown-item', 'Order not found for this shop.');
  }
  return order;
}

async function requireSaleView(repo: ReturnType<typeof getCommerceRepository>, tenantId: string, saleId: string): Promise<Sale> {
  const sale = await repo.getSaleView(tenantId, saleId);
  if (!sale) {
    throw new CommerceError('unknown-item', 'Sale not found for this shop.');
  }
  return sale;
}

export async function createAndSubmitOrder(
  session: CommerceSession,
  input: CreateCommerceOrderInput,
): Promise<{ order: Order; sale: Sale | null; route: 'PENDING_REVIEW' | 'AUTO_APPROVE'; duplicate: boolean }> {
  const repo = getCommerceRepository();
  const key = normalizeIdempotencyKey(input.idempotencyKey ?? null);
  const source: OrderSource =
    input.source ?? (session.userRole === 'shop_admin' || session.userRole === 'super_admin' ? 'ADMIN' : 'STAFF');
  const paymentMethod = input.paymentMethod ?? 'CASH';

  const policy = await repo.getTenantPolicy(session.tenantId);
  const created = await repo.createOrder({
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
    orderReviewRequired: policy.orderReviewRequired,
    sellerCredentialId: input.sellerCredentialId ?? null,
    paymentMethod,
    customerPhone: input.customerPhone ?? null,
  });

  if (created.duplicate) {
    return { order: await requireOrderView(repo, session.tenantId, created.order.id), sale: null, route: 'AUTO_APPROVE', duplicate: true };
  }

    const submitted = await repo.submitOrder({
      tenantId: session.tenantId,
      orderId: created.order.id,
      actorId: session.userId,
      actorRole: actorRoleOf(session),
      orderReviewRequired: policy.orderReviewRequired,
      forceReview: paymentMethod === 'MPESA',
    });

  // Staff-speed path: an auto-approved CASH order finalizes its sale in the
  // repository transaction and records its cash payment. M-Pesa orders stay
  // held for provider confirmation (no sale, no stock movement).
  let sale: Sale | null = null;
  if (submitted.route === 'AUTO_APPROVE' && paymentMethod === 'CASH') {
    const finalized = await repo.finalizeApprovedOrder({
      tenantId: session.tenantId,
      orderId: created.order.id,
      actorId: session.userId,
    });
    await recordCashPayment(repo, {
      tenantId: session.tenantId,
      orderId: created.order.id,
      saleId: finalized.sale.id,
      amount: finalized.sale.total,
      currencyCode: finalized.sale.currencyCode,
      actorId: session.userId,
    });
    sale = await requireSaleView(repo, session.tenantId, finalized.sale.id);
  }

  return { order: await requireOrderView(repo, session.tenantId, created.order.id), sale, route: submitted.route, duplicate: false };
}

export async function submitCommerceOrder(
  session: CommerceSession,
  orderId: string,
): Promise<{ order: Order; route: 'PENDING_REVIEW' | 'AUTO_APPROVE' }> {
  const repo = getCommerceRepository();
  const policy = await repo.getTenantPolicy(session.tenantId);
  const submitted = await repo.submitOrder({
    tenantId: session.tenantId,
    orderId,
    actorId: session.userId,
    actorRole: actorRoleOf(session),
    orderReviewRequired: policy.orderReviewRequired,
  });
  return { order: await requireOrderView(repo, session.tenantId, orderId), route: submitted.route };
}

export async function approveCommerceOrder(
  session: CommerceSession,
  orderId: string,
): Promise<{ order: Order; sale: Sale; duplicate: boolean }> {
  const repo = getCommerceRepository();
  const result = await repo.approveOrder({
    tenantId: session.tenantId,
    orderId,
    actorId: session.userId,
    actorRole: actorRoleOf(session),
  });
  if (!result.duplicate) {
    const order = await requireOrderView(repo, session.tenantId, orderId);
    if ((order.paymentMethod ?? 'CASH') === 'CASH') {
      await recordCashPayment(repo, {
        tenantId: session.tenantId,
        orderId,
        saleId: result.sale.id,
        amount: result.sale.total,
        currencyCode: result.sale.currencyCode,
        actorId: session.userId,
      });
    }
  }
  return {
    order: await requireOrderView(repo, session.tenantId, orderId),
    sale: await requireSaleView(repo, session.tenantId, result.sale.id),
    duplicate: result.duplicate,
  };
}

export async function rejectCommerceOrder(
  session: CommerceSession,
  orderId: string,
  reason?: string | null,
): Promise<Order> {
  const repo = getCommerceRepository();
  await repo.rejectOrder({
    tenantId: session.tenantId,
    orderId,
    actorId: session.userId,
    actorRole: actorRoleOf(session),
    reason: reason ?? null,
  });
  return requireOrderView(repo, session.tenantId, orderId);
}

export async function cancelCommerceOrder(session: CommerceSession, orderId: string): Promise<Order> {
  const repo = getCommerceRepository();
  await repo.cancelOrder({ tenantId: session.tenantId, orderId });
  return requireOrderView(repo, session.tenantId, orderId);
}

export async function voidCommerceSale(
  session: CommerceSession,
  saleId: string,
  reason?: string | null,
): Promise<Sale> {
  const repo = getCommerceRepository();
  const result = await repo.voidSale({
    tenantId: session.tenantId,
    saleId,
    actorId: session.userId,
    actorRole: actorRoleOf(session),
    reason: reason ?? null,
  });
  void result;
  return requireSaleView(repo, session.tenantId, saleId);
}

export async function listCommerceOrders(session: CommerceSession, options: { ownOnly?: boolean } = {}): Promise<Order[]> {
  const repo = getCommerceRepository();
  const orders = await repo.listOrderViews(session.tenantId);
  if (session.userRole === 'staff' || options.ownOnly) {
    return orders.filter((order) => order.sellerId === session.userId);
  }
  return orders;
}

export async function getCommerceOrder(session: CommerceSession, orderId: string): Promise<Order | null> {
  const repo = getCommerceRepository();
  const order = await repo.getOrderView(session.tenantId, orderId);
  if (!order) {
    return null;
  }
  if (session.userRole === 'staff' && order.sellerId !== session.userId) {
    return null;
  }
  return order;
}

export async function listCommerceSales(session: CommerceSession, options: { ownOnly?: boolean } = {}): Promise<Sale[]> {
  const repo = getCommerceRepository();
  const sales = await repo.listSaleViews(session.tenantId);
  if (session.userRole === 'staff' || options.ownOnly) {
    return sales.filter((sale) => sale.sellerId === session.userId);
  }
  return sales;
}

export async function getCommerceSale(session: CommerceSession, saleId: string): Promise<Sale | null> {
  const repo = getCommerceRepository();
  const sale = await repo.getSaleView(session.tenantId, saleId);
  if (!sale) {
    return null;
  }
  if (session.userRole === 'staff' && sale.sellerId !== session.userId) {
    return null;
  }
  return sale;
}

export async function getTenantPolicy(tenantId: string): Promise<{ orderReviewRequired: boolean }> {
  const repo = getCommerceRepository();
  const policy = await repo.getTenantPolicy(tenantId);
  return { orderReviewRequired: policy.orderReviewRequired };
}
