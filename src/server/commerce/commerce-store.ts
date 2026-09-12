/**
 * Commerce persistence operations (Phase 2, unit 4).
 *
 * Every function below is designed to run INSIDE one `updateStore` mutator
 * (file projection) or one relational transaction (future SQL adapter), so a
 * sale and its inventory movements commit atomically — never sale-without-
 * stock or stock-without-sale. All-or-nothing is structural: any throw before
 * the mutator returns discards every write in the unit.
 *
 * Operates on minimal structural store types so the full matrix runs under
 * `node --test`. The real StoreState is assignable.
 */

import { randomUUID } from 'node:crypto';

import { normalizeIdempotencyKey } from './idempotency.ts';
import {
  applyMovement,
  resolveServiceConsumption,
  type InventoryMovementType,
} from './inventory.ts';
import {
  CommerceError,
  assertClientTotal,
  buildOrderLines,
  routeNewOrder,
  transitionOrderStatus,
  type BuiltOrderLine,
  type CartLineRequest,
  type OrderSource,
  type OrderStatus,
} from './orders.ts';

// ── Structural store ─────────────────────────────────────────────────────────

export type ActorRole = 'shop_admin' | 'staff' | 'super_admin' | 'customer' | 'system';

export type OpsProduct = {
  id: string;
  tenantId: string;
  name: string;
  sellingPrice?: number | null;
  unitCost?: number;
  sku?: string | null;
  quantityOnHand?: number;
  isActive: boolean;
};

export type OpsService = {
  id: string;
  tenantId: string;
  name: string;
  price: number;
  durationMinutes?: number;
  commissionType: 'fixed' | 'percentage';
  commissionValue: number;
  isActive: boolean;
};

export type OpsCustomer = { id: string; tenantId: string };
export type OpsUser = {
  id: string;
  tenantId: string | null;
  commissionType?: 'fixed' | 'percentage';
  commissionValue?: number;
};

export type OpsBomLink = {
  id: string;
  tenantId: string;
  serviceId: string;
  productId: string;
  quantity: number;
};

export type OpsOrderItem = {
  id: string;
  tenantId: string;
  orderId: string;
  itemType: 'PRODUCT' | 'SERVICE';
  productId?: string | null;
  serviceId?: string | null;
  quantity: number;
  catalogUnitPrice: number;
  actualUnitPrice: number;
  lineTotal: number;
  itemName: string;
  itemSnapshot?: Record<string, unknown>;
  commissionType?: 'fixed' | 'percentage';
  commissionValue?: number;
  commissionAmount?: number;
  overrideReason?: string | null;
  overrideBy?: string | null;
  overrideAt?: string | null;
  createdAt: string;
};

export type OpsOrder = {
  id: string;
  tenantId: string;
  customerId?: string | null;
  sellerId?: string | null;
  status: OrderStatus;
  subtotal: number;
  total: number;
  currencyCode: string;
  source: string;
  notes?: string | null;
  idempotencyKey?: string | null;
  quotedAt?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  createdBy?: string | null;
  /** Phase 3 audit link: credential that created the order (null otherwise). */
  sellerCredentialId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OpsSaleItem = Omit<OpsOrderItem, 'orderId'> & {
  saleId: string;
  overrideHistoryUnknown?: boolean;
};

export type OpsSale = {
  id: string;
  tenantId: string;
  orderId: string;
  customerId?: string | null;
  sellerId?: string | null;
  status: 'PENDING' | 'COMPLETED' | 'VOIDED';
  subtotal: number;
  total: number;
  currencyCode: string;
  idempotencyKey?: string | null;
  approvedAt?: string | null;
  approvedBy?: string | null;
  completedAt?: string | null;
  recordedBy?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  /** Phase 3 audit link, copied from the order at finalization. */
  sellerCredentialId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OpsMovement = {
  id: string;
  tenantId: string;
  productId: string;
  quantity: number;
  movementType: string;
  referenceType?: string | null;
  referenceId?: string | null;
  unitCost?: number | null;
  previousQuantity: number;
  resultingQuantity: number;
  reason?: string | null;
  createdBy?: string | null;
  createdAt: string;
};

export type CommerceStore = {
  products: OpsProduct[];
  services: OpsService[];
  customers: OpsCustomer[];
  users: OpsUser[];
  serviceProductLinks?: OpsBomLink[];
  inventoryMovements?: OpsMovement[];
  sellerCredentials?: { id: string; tenantId: string; sellerId: string; status: string }[];
  orders: OpsOrder[];
  orderItems: OpsOrderItem[];
  sales: OpsSale[];
  saleItems: OpsSaleItem[];
};

export type OpContext = {
  now?: string;
  generateId?: () => string;
  /** Allow negative stock (reserved for a future admin policy; never set in Phase 2). */
  allowNegative?: boolean;
};

function contextNow(ctx: OpContext): string {
  return ctx.now ?? new Date().toISOString();
}

function contextId(ctx: OpContext): string {
  return (ctx.generateId ?? randomUUID)();
}

// ── Lookups (all tenant-scoped) ──────────────────────────────────────────────

function findOrder(store: CommerceStore, tenantId: string, orderId: string): OpsOrder {
  const order = store.orders.find((item) => item.id === orderId && item.tenantId === tenantId) ?? null;
  if (!order) {
    throw new CommerceError('unknown-item', 'Order not found for this shop.');
  }
  return order;
}

function findSale(store: CommerceStore, tenantId: string, saleId: string): OpsSale {
  const sale = store.sales.find((item) => item.id === saleId && item.tenantId === tenantId) ?? null;
  if (!sale) {
    throw new CommerceError('unknown-item', 'Sale not found for this shop.');
  }
  return sale;
}

function orderLinesOf(store: CommerceStore, order: OpsOrder): OpsOrderItem[] {
  return store.orderItems.filter((item) => item.orderId === order.id && item.tenantId === order.tenantId);
}

// ── Order creation ───────────────────────────────────────────────────────────

export type CreateOrderInput = {
  tenantId: string;
  customerId?: string | null;
  sellerId?: string | null;
  source: OrderSource;
  notes?: string | null;
  currencyCode?: string;
  lines: CartLineRequest[];
  clientTotal?: number | null;
  idempotencyKey?: string | null;
  creatorRole: ActorRole;
  creatorId: string;
  orderReviewRequired: boolean;
  /** Phase 3: QR credential attribution. Validated below when present. */
  sellerCredentialId?: string | null;
};

export function createOrder(
  store: CommerceStore,
  input: CreateOrderInput,
  ctx: OpContext = {},
): { order: OpsOrder; items: OpsOrderItem[]; duplicate: boolean } {
  const key = input.idempotencyKey ?? null;
  if (key) {
    const existing = store.orders.find((item) => item.tenantId === input.tenantId && item.idempotencyKey === key) ?? null;
    if (existing) {
      return { order: existing, items: orderLinesOf(store, existing), duplicate: true };
    }
  }

  if (input.customerId) {
    const customer = store.customers.find((item) => item.id === input.customerId) ?? null;
    if (!customer) {
      throw new CommerceError('unknown-item', 'Customer not found for this shop.');
    }
    if (customer.tenantId !== input.tenantId) {
      throw new CommerceError('cross-tenant-item', 'That customer belongs to another shop.');
    }
  }

  if (input.sellerId) {
    const seller = store.users.find((item) => item.id === input.sellerId) ?? null;
    if (!seller || (seller.tenantId !== null && seller.tenantId !== input.tenantId)) {
      throw new CommerceError('unknown-item', 'Seller not found for this shop.');
    }
  }

  // Phase 3 defense-in-depth: a credential link must reference an ACTIVE
  // credential for the same tenant and seller. QR actions verify the bearer
  // first; this keeps direct callers honest too.
  if (input.sellerCredentialId) {
    const credential = (store.sellerCredentials ?? []).find((item) => item.id === input.sellerCredentialId) ?? null;
    if (
      !credential ||
      credential.tenantId !== input.tenantId ||
      credential.sellerId !== (input.sellerId ?? '') ||
      credential.status !== 'ACTIVE'
    ) {
      throw new CommerceError('unknown-item', 'Seller credential not found for this shop.');
    }
  }

  // Staff commission terms override service defaults (legacy parity): the
  // snapshot below must reflect the seller's terms at finalization time.
  const seller = input.sellerId
    ? store.users.find((item) => item.id === input.sellerId) ?? null
    : null;
  const staffCommission =
    seller?.commissionType !== undefined
      ? { commissionType: seller.commissionType, commissionValue: seller.commissionValue ?? 0 }
      : null;

  const cart = buildOrderLines({
    tenantId: input.tenantId,
    products: store.products.map((product) => ({
      id: product.id,
      tenantId: product.tenantId,
      name: product.name,
      sellingPrice: product.sellingPrice ?? null,
      unitCost: product.unitCost ?? 0,
      sku: product.sku ?? null,
      isActive: product.isActive,
    })),
    services: store.services.map((service) => ({
      id: service.id,
      tenantId: service.tenantId,
      name: service.name,
      price: service.price,
      durationMinutes: service.durationMinutes,
      commissionType: service.commissionType,
      commissionValue: service.commissionValue,
      isActive: service.isActive,
    })),
    lines: input.lines,
    staffCommission,
  });
  assertClientTotal(cart.total, input.clientTotal);

  const now = contextNow(ctx);
  const orderId = contextId(ctx);
  const order: OpsOrder = {
    id: orderId,
    tenantId: input.tenantId,
    customerId: input.customerId ?? null,
    sellerId: input.sellerId ?? null,
    status: 'DRAFT',
    subtotal: cart.subtotal,
    total: cart.total,
    currencyCode: input.currencyCode ?? 'KES',
    source: input.source,
    notes: input.notes ?? null,
    idempotencyKey: key,
    quotedAt: now,
    createdBy: input.creatorId,
    sellerCredentialId: input.sellerCredentialId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  store.orders.push(order);

  const items = cart.lines.map((line) =>
    pushOrderItem(store, order, line, input.creatorId, now, contextId(ctx)),
  );

  return { order, items, duplicate: false };
}

function pushOrderItem(
  store: CommerceStore,
  order: OpsOrder,
  line: BuiltOrderLine,
  creatorId: string,
  now: string,
  id: string,
): OpsOrderItem {
  const item: OpsOrderItem = {
    id,
    tenantId: order.tenantId,
    orderId: order.id,
    itemType: line.kind === 'product' ? 'PRODUCT' : 'SERVICE',
    productId: line.productId,
    serviceId: line.serviceId,
    quantity: line.quantity,
    catalogUnitPrice: line.catalogUnitPrice,
    actualUnitPrice: line.actualUnitPrice,
    lineTotal: line.lineTotal,
    itemName: line.itemName,
    itemSnapshot: line.itemSnapshot,
    commissionType: line.commissionType,
    commissionValue: line.commissionValue,
    commissionAmount: line.commissionAmount,
    overrideReason: line.override?.reason ?? null,
    overrideBy: line.override ? creatorId : null,
    overrideAt: line.override ? now : null,
    createdAt: now,
  };
  store.orderItems.push(item);
  return item;
}

// ── Submit (DRAFT → SUBMITTED → PENDING_REVIEW | APPROVED) ───────────────────

export function submitOrder(
  store: CommerceStore,
  input: { tenantId: string; orderId: string; actorId: string; actorRole: ActorRole; orderReviewRequired: boolean },
  ctx: OpContext = {},
): { order: OpsOrder; route: 'PENDING_REVIEW' | 'AUTO_APPROVE' } {
  const order = findOrder(store, input.tenantId, input.orderId);
  const now = contextNow(ctx);

  order.status = transitionOrderStatus(order.status, 'SUBMITTED');
  order.submittedAt = now;
  order.updatedAt = now;

  const items = orderLinesOf(store, order);
  const hasDownwardOverride = items.some(
    (item) => item.overrideReason !== null && item.overrideReason !== undefined && item.actualUnitPrice - item.catalogUnitPrice < 0,
  );

  const decision = routeNewOrder({
    source: order.source as OrderSource,
    creatorRole: input.actorRole,
    hasDownwardOverride,
    orderReviewRequired: input.orderReviewRequired,
  });

  if (decision === 'PENDING_REVIEW') {
    order.status = transitionOrderStatus(order.status, 'PENDING_REVIEW');
    order.updatedAt = now;
    return { order, route: decision };
  }

  order.status = transitionOrderStatus(order.status, 'APPROVED');
  order.approvedAt = now;
  order.approvedBy = input.actorId;
  order.updatedAt = now;
  return { order, route: decision };
}

// ── Approve (→ sale, atomic inventory) ───────────────────────────────────────

export type StockRequirement = { productId: string; quantity: number };

/**
 * Compute every product deduction an approval needs: product lines plus BOM
 * consumption for service lines. Pure — used to pre-validate before mutating.
 */
export function requiredStockForItems(
  links: OpsBomLink[],
  tenantId: string,
  items: { itemType: 'PRODUCT' | 'SERVICE'; productId?: string | null; serviceId?: string | null; quantity: number }[],
): StockRequirement[] {
  const required = new Map<string, number>();
  const add = (productId: string, quantity: number) => {
    required.set(productId, (required.get(productId) ?? 0) + quantity);
  };

  for (const item of items) {
    if (item.itemType === 'PRODUCT' && item.productId) {
      add(item.productId, item.quantity);
      continue;
    }
    if (item.itemType === 'SERVICE' && item.serviceId) {
      for (const line of resolveServiceConsumption(
        links.map((link) => ({ serviceId: link.serviceId, tenantId: link.tenantId, productId: link.productId, quantity: link.quantity })),
        tenantId,
        item.serviceId,
        item.quantity,
      )) {
        add(line.productId, line.quantity);
      }
    }
  }

  return [...required.entries()].map(([productId, quantity]) => ({ productId, quantity }));
}

export function approveOrder(
  store: CommerceStore,
  input: { tenantId: string; orderId: string; actorId: string; actorRole: ActorRole },
  ctx: OpContext = {},
): { order: OpsOrder; sale: OpsSale; duplicate: boolean } {
  if (input.actorRole !== 'shop_admin' && input.actorRole !== 'super_admin') {
    throw new CommerceError('not-permitted', 'Only admins can approve orders.');
  }

  const order = findOrder(store, input.tenantId, input.orderId);

  // Exactly-one-sale invariant: the order link decides, never a second insert.
  const existingSale = store.sales.find((sale) => sale.orderId === order.id && sale.tenantId === order.tenantId) ?? null;
  if (existingSale) {
    return { order, sale: existingSale, duplicate: true };
  }
  if (order.status === 'COMPLETED') {
    throw new CommerceError('already-approved', 'That order was already approved.');
  }

  const now = contextNow(ctx);
  // APPROVED is accepted as a no-op: submitOrder may have auto-approved, and
  // concurrent approvals must converge instead of tripping the state machine.
  if (order.status !== 'APPROVED') {
    order.status = transitionOrderStatus(order.status, 'APPROVED');
  }
  order.approvedAt = now;
  order.approvedBy = input.actorId;
  order.updatedAt = now;

  return finalizeApprovedOrder(store, { tenantId: input.tenantId, orderId: input.orderId, actorId: input.actorId }, ctx);
}

/**
 * Finalize an APPROVED order into a COMPLETED sale with atomic inventory.
 * Permission-free by design: callers must have earned APPROVED status through
 * submit routing (staff auto-approve path) or an admin approveOrder first.
 */
export function finalizeApprovedOrder(
  store: CommerceStore,
  input: { tenantId: string; orderId: string; actorId: string },
  ctx: OpContext = {},
): { order: OpsOrder; sale: OpsSale; duplicate: boolean } {
  const order = findOrder(store, input.tenantId, input.orderId);

  const existingSale = store.sales.find((sale) => sale.orderId === order.id && sale.tenantId === order.tenantId) ?? null;
  if (existingSale) {
    return { order, sale: existingSale, duplicate: true };
  }
  if (order.status === 'COMPLETED') {
    throw new CommerceError('already-approved', 'That order was already approved.');
  }
  if (order.status !== 'APPROVED') {
    throw new CommerceError('invalid-transition', 'Order must be approved before the sale is finalized.');
  }

  const now = contextNow(ctx);
  const items = orderLinesOf(store, order);

  // 1. Pre-validate ALL stock before posting ANY movement (no partial sales).
  const requirements = requiredStockForItems(store.serviceProductLinks ?? [], order.tenantId, items);
  for (const requirement of requirements) {
    const product = store.products.find(
      (item) => item.id === requirement.productId && item.tenantId === order.tenantId,
    ) ?? null;
    const onHand = product?.quantityOnHand ?? 0;
    if (!product || (!ctx.allowNegative && onHand - requirement.quantity < 0)) {
      throw new CommerceError(
        'insufficient-stock',
        'Insufficient stock to complete this sale. No stock was deducted.',
      );
    }
  }

  // 2. Finalize the sale with full snapshots.
  const saleId = contextId(ctx);
  const sale: OpsSale = {
    id: saleId,
    tenantId: order.tenantId,
    orderId: order.id,
    customerId: order.customerId ?? null,
    sellerId: order.sellerId ?? null,
    status: 'COMPLETED',
    subtotal: order.subtotal,
    total: order.total,
    currencyCode: order.currencyCode,
    idempotencyKey: order.idempotencyKey ?? null,
    approvedAt: now,
    approvedBy: input.actorId,
    completedAt: now,
    recordedBy: input.actorId,
    sellerCredentialId: order.sellerCredentialId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  store.sales.push(sale);

  const links = store.serviceProductLinks ?? [];
  for (const item of items) {
    const consumed = item.itemType === 'SERVICE' && item.serviceId
      ? resolveServiceConsumption(
        links.map((link) => ({ serviceId: link.serviceId, tenantId: link.tenantId, productId: link.productId, quantity: link.quantity })),
        order.tenantId,
        item.serviceId,
        item.quantity,
      )
      : [];

    store.saleItems.push({
      id: contextId(ctx),
      tenantId: order.tenantId,
      saleId,
      itemType: item.itemType,
      productId: item.productId ?? null,
      serviceId: item.serviceId ?? null,
      quantity: item.quantity,
      catalogUnitPrice: item.catalogUnitPrice,
      actualUnitPrice: item.actualUnitPrice,
      lineTotal: item.lineTotal,
      itemName: item.itemName,
      itemSnapshot: { ...(item.itemSnapshot ?? {}), consumedProducts: consumed },
      commissionType: item.commissionType ?? 'percentage',
      commissionValue: item.commissionValue ?? 0,
      commissionAmount: item.commissionAmount ?? 0,
      overrideReason: item.overrideReason ?? null,
      overrideBy: item.overrideBy ?? null,
      overrideAt: item.overrideAt ?? null,
      overrideHistoryUnknown: false,
      createdAt: now,
    });

    // 3. Post inventory: product lines as SALE, service lines as consumption.
    if (item.itemType === 'PRODUCT' && item.productId) {
      postSaleMovement(store, order, sale, item.productId, -item.quantity, 'SALE', input.actorId, now, ctx);
    }
    for (const line of consumed) {
      postSaleMovement(store, order, sale, line.productId, -line.quantity, 'SERVICE_CONSUMPTION', input.actorId, now, ctx);
    }
  }

  order.status = transitionOrderStatus(order.status, 'COMPLETED');
  order.completedAt = now;
  order.updatedAt = now;

  return { order, sale, duplicate: false };
}

function postSaleMovement(
  store: CommerceStore,
  order: OpsOrder,
  sale: OpsSale,
  productId: string,
  quantity: number,
  type: InventoryMovementType,
  actorId: string,
  now: string,
  ctx: OpContext,
): void {
  const product = store.products.find((item) => item.id === productId && item.tenantId === order.tenantId) ?? null;
  if (!product) {
    throw new CommerceError('unknown-item', 'A product required by this sale is missing.');
  }
  const previous = product.quantityOnHand ?? 0;
  const application = applyMovement(previous, { type, quantity }, { allowNegative: ctx.allowNegative });
  store.inventoryMovements ??= [];
  const foundProduct = store.products.find((item) => item.id === productId && item.tenantId === order.tenantId);
  store.inventoryMovements.push({
    id: contextId(ctx),
    tenantId: order.tenantId,
    productId,
    quantity,
    movementType: type,
    referenceType: 'sale',
    referenceId: sale.id,
    unitCost: foundProduct?.unitCost ?? null,
    previousQuantity: application.previousQuantity,
    resultingQuantity: application.resultingQuantity,
    reason: null,
    createdBy: actorId,
    createdAt: now,
  });
  if (foundProduct) {
    foundProduct.quantityOnHand = application.resultingQuantity;
  }
}

// ── Reject / cancel ──────────────────────────────────────────────────────────

export function rejectOrder(
  store: CommerceStore,
  input: { tenantId: string; orderId: string; actorId: string; actorRole: ActorRole; reason?: string | null },
  ctx: OpContext = {},
): OpsOrder {
  if (input.actorRole !== 'shop_admin' && input.actorRole !== 'super_admin') {
    throw new CommerceError('not-permitted', 'Only admins can reject orders.');
  }
  const order = findOrder(store, input.tenantId, input.orderId);
  const now = contextNow(ctx);
  order.status = transitionOrderStatus(order.status, 'REJECTED');
  order.rejectedAt = now;
  order.rejectionReason = input.reason?.trim() || null;
  order.updatedAt = now;
  return order;
}

export function cancelOrder(
  store: CommerceStore,
  input: { tenantId: string; orderId: string },
  ctx: OpContext = {},
): OpsOrder {
  const order = findOrder(store, input.tenantId, input.orderId);
  const now = contextNow(ctx);
  order.status = transitionOrderStatus(order.status, 'CANCELLED');
  order.cancelledAt = now;
  order.updatedAt = now;
  return order;
}

// ── Void (with reversal) ─────────────────────────────────────────────────────

export function voidSale(
  store: CommerceStore,
  input: { tenantId: string; saleId: string; actorId: string; actorRole: ActorRole; reason?: string | null },
  ctx: OpContext = {},
): { sale: OpsSale; reversals: OpsMovement[] } {
  if (input.actorRole !== 'shop_admin' && input.actorRole !== 'super_admin') {
    throw new CommerceError('not-permitted', 'Only admins can void sales.');
  }
  const sale = findSale(store, input.tenantId, input.saleId);
  if (sale.status === 'VOIDED') {
    throw new CommerceError('already-voided', 'That sale was already voided.');
  }
  if (sale.status !== 'COMPLETED') {
    throw new CommerceError('invalid-transition', 'Only completed sales can be voided.');
  }

  const now = contextNow(ctx);
  const reversals: OpsMovement[] = [];
  const items = store.saleItems.filter((item) => item.saleId === sale.id && item.tenantId === sale.tenantId);

  for (const item of items) {
    // Product units return to the shelf as RETURN; consumed service components
    // were physically used up, so their reversal is an audited ADJUSTMENT.
    if (item.itemType === 'PRODUCT' && item.productId) {
      reversals.push(
        reverseMovement(store, sale, item.productId, item.quantity, 'RETURN', input.actorId, now, ctx),
      );
    }
    const consumed = (item.itemSnapshot?.consumedProducts ?? []) as { productId: string; quantity: number }[];
    for (const line of consumed) {
      reversals.push(
        reverseMovement(store, sale, line.productId, line.quantity, 'ADJUSTMENT', input.actorId, now, ctx),
      );
    }
  }

  sale.status = 'VOIDED';
  sale.voidedAt = now;
  sale.voidedBy = input.actorId;
  sale.voidReason = input.reason?.trim() || 'Sale voided.';
  sale.updatedAt = now;

  return { sale, reversals };
}

function reverseMovement(
  store: CommerceStore,
  sale: OpsSale,
  productId: string,
  quantity: number,
  type: InventoryMovementType,
  actorId: string,
  now: string,
  ctx: OpContext,
): OpsMovement {
  const product = store.products.find((item) => item.id === productId && item.tenantId === sale.tenantId) ?? null;
  if (!product) {
    throw new CommerceError('unknown-item', 'A product required by this reversal is missing.');
  }
  const application = applyMovement(product.quantityOnHand ?? 0, { type, quantity }, { allowNegative: true });
  const movement: OpsMovement = {
    id: contextId(ctx),
    tenantId: sale.tenantId,
    productId,
    quantity,
    movementType: type,
    referenceType: 'sale_void',
    referenceId: sale.id,
    unitCost: product.unitCost ?? null,
    previousQuantity: application.previousQuantity,
    resultingQuantity: application.resultingQuantity,
    reason: `Reversal for voided sale ${sale.id}`,
    createdBy: actorId,
    createdAt: now,
  };
  store.inventoryMovements ??= [];
  store.inventoryMovements.push(movement);
  product.quantityOnHand = application.resultingQuantity;
  return movement;
}

// ── Idempotency helpers (Phase 0 mechanism, order namespace) ─────────────────

export function parseOrderIdempotencyKey(raw: unknown): string | null {
  return normalizeIdempotencyKey(raw);
}

export function findOrderByIdempotencyKey(store: CommerceStore, tenantId: string, key: string | null): OpsOrder | null {
  if (!key) {
    return null;
  }
  return store.orders.find((item) => item.tenantId === tenantId && item.idempotencyKey === key) ?? null;
}
