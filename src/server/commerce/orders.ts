/**
 * Orders + sales domain engine (Phase 2).
 *
 * Distinct concepts: ORDER (intent + review) vs SALE (commercial transaction).
 * PAYMENT / RECONCILIATION / LEDGER do not exist here — sales complete without
 * any payment state (payment arrives in Phase 4).
 *
 * Status vocabularies MUST match db/migrations/phase-02-orders-sales.sql
 * (guarded by scripts/verify-phase-migrations.js).
 *
 * Dependency-free except the pure commission helper: runs under `node --test`.
 */

import { calculateCommerceCommission } from './commission.ts';
import { SaleValidationError } from './sale-validation.ts';

export type OrderStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REJECTED';

export type SaleStatus = 'PENDING' | 'COMPLETED' | 'VOIDED';

export type OrderSource =
  | 'ADMIN'
  | 'STAFF'
  | 'CUSTOMER_BOOKING'
  | 'SELLER_QR'
  | 'CUSTOMER_SELF_SERVICE'
  | 'API';

export type CommerceErrorCode =
  | 'empty-order'
  | 'unknown-item'
  | 'cross-tenant-item'
  | 'inactive-item'
  | 'needs-pricing'
  | 'invalid-price'
  | 'invalid-quantity'
  | 'total-mismatch'
  | 'invalid-transition'
  | 'override-reason-required'
  | 'amendment-reason-required'
  | 'not-permitted'
  | 'insufficient-stock'
  | 'already-approved'
  | 'already-voided';

export class CommerceError extends Error {
  readonly code: CommerceErrorCode;

  constructor(code: CommerceErrorCode, message: string) {
    super(message);
    this.name = 'CommerceError';
    this.code = code;
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

const LEGAL_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['PENDING_REVIEW', 'APPROVED', 'CANCELLED'],
  PENDING_REVIEW: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

/** Enforce the order state machine. Terminal states accept no transitions. */
export function transitionOrderStatus(current: OrderStatus, next: OrderStatus): OrderStatus {
  if (!LEGAL_TRANSITIONS[current].includes(next)) {
    throw new CommerceError(
      'invalid-transition',
      `Order cannot move from ${current} to ${next}.`,
    );
  }
  return next;
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED' || status === 'REJECTED';
}

// ── Cart builder ─────────────────────────────────────────────────────────────

export type CartLineRequest = {
  kind: 'product' | 'service';
  refId: string;
  quantity: number;
  /** Omitted/null = charge the catalog price. */
  actualUnitPrice?: number | null;
  /** Required whenever actual differs from catalog. */
  overrideReason?: string | null;
};

export type CatalogProductView = {
  id: string;
  tenantId: string;
  name: string;
  sellingPrice: number | null;
  unitCost: number;
  sku: string | null;
  isActive: boolean;
};

export type CatalogServiceView = {
  id: string;
  tenantId: string;
  name: string;
  price: number;
  durationMinutes?: number;
  commissionType: 'fixed' | 'percentage';
  commissionValue: number;
  isActive: boolean;
};

export type BuiltOrderLine = {
  kind: 'product' | 'service';
  productId: string | null;
  serviceId: string | null;
  quantity: number;
  catalogUnitPrice: number;
  actualUnitPrice: number;
  lineTotal: number;
  itemName: string;
  itemSnapshot: Record<string, unknown>;
  commissionType: 'fixed' | 'percentage';
  commissionValue: number;
  commissionAmount: number;
  override: {
    catalogPrice: number;
    actualPrice: number;
    difference: number;
    reason: string;
  } | null;
};

export type BuiltCart = {
  lines: BuiltOrderLine[];
  subtotal: number;
  total: number;
  hasDownwardOverride: boolean;
};

function assertPositiveIntegerQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new CommerceError('invalid-quantity', 'Each order line needs a positive whole-number quantity.');
  }
}

function assertValidActualPrice(actual: number): void {
  if (!Number.isFinite(actual) || actual < 0) {
    throw new CommerceError('invalid-price', 'Actual unit prices must be valid amounts of zero or more.');
  }
}

/**
 * Build validated order lines with catalog snapshots. The server owns every
 * number: catalog prices come from the tenant catalog, totals are recomputed,
 * and overrides are recorded explicitly — never silently applied.
 */
export function buildOrderLines(input: {
  tenantId: string;
  products: CatalogProductView[];
  services: CatalogServiceView[];
  lines: CartLineRequest[];
  staffCommission?: { commissionType: 'fixed' | 'percentage'; commissionValue: number } | null;
}): BuiltCart {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new CommerceError('empty-order', 'An order needs at least one product or service line.');
  }

  const built: BuiltOrderLine[] = [];
  let hasDownwardOverride = false;

  for (const line of input.lines) {
    assertPositiveIntegerQuantity(line.quantity);

    if (line.kind === 'product') {
      const product = input.products.find((item) => item.id === line.refId) ?? null;
      if (!product) {
        throw new CommerceError('unknown-item', 'One of the products in this order does not exist.');
      }
      if (product.tenantId !== input.tenantId) {
        throw new CommerceError('cross-tenant-item', 'One of the products belongs to another shop.');
      }
      if (!product.isActive) {
        throw new CommerceError('inactive-item', `“${product.name}” is not currently sellable.`);
      }
      if (product.sellingPrice === null || product.sellingPrice === undefined) {
        throw new CommerceError(
          'needs-pricing',
          `“${product.name}” has no selling price yet. Set one before selling it.`,
        );
      }

      const actual = line.actualUnitPrice === undefined || line.actualUnitPrice === null
        ? product.sellingPrice
        : line.actualUnitPrice;
      assertValidActualPrice(actual);
      const override = describeOverride(product.sellingPrice, actual, line.overrideReason ?? null);
      if (override && override.difference < 0) {
        hasDownwardOverride = true;
      }

      built.push({
        kind: 'product',
        productId: product.id,
        serviceId: null,
        quantity: line.quantity,
        catalogUnitPrice: product.sellingPrice,
        actualUnitPrice: actual,
        lineTotal: line.quantity * actual,
        itemName: product.name,
        itemSnapshot: { sku: product.sku, unitCost: product.unitCost },
        commissionType: 'percentage',
        commissionValue: 0,
        commissionAmount: 0,
        override,
      });
      continue;
    }

    if (line.kind === 'service') {
      const service = input.services.find((item) => item.id === line.refId) ?? null;
      if (!service) {
        throw new CommerceError('unknown-item', 'One of the services in this order does not exist.');
      }
      if (service.tenantId !== input.tenantId) {
        throw new CommerceError('cross-tenant-item', 'One of the services belongs to another shop.');
      }
      if (!service.isActive) {
        throw new CommerceError('inactive-item', `“${service.name}” is not currently sellable.`);
      }

      const actual = line.actualUnitPrice === undefined || line.actualUnitPrice === null
        ? service.price
        : line.actualUnitPrice;
      assertValidActualPrice(actual);
      const override = describeOverride(service.price, actual, line.overrideReason ?? null);
      if (override && override.difference < 0) {
        hasDownwardOverride = true;
      }

      const commission = calculateCommerceCommission({
        service: { commissionType: service.commissionType, commissionValue: service.commissionValue },
        staff: input.staffCommission ?? null,
        price: actual,
      });

      built.push({
        kind: 'service',
        productId: null,
        serviceId: service.id,
        quantity: line.quantity,
        catalogUnitPrice: service.price,
        actualUnitPrice: actual,
        lineTotal: line.quantity * actual,
        itemName: service.name,
        itemSnapshot: { durationMinutes: service.durationMinutes ?? null },
        commissionType: commission.commissionType,
        commissionValue: commission.commissionValue,
        commissionAmount: commission.commissionAmount * line.quantity,
        override,
      });
      continue;
    }

    throw new CommerceError('unknown-item', 'Each order line must be a product or a service.');
  }

  const total = built.reduce((sum, line) => sum + line.lineTotal, 0);
  return { lines: built, subtotal: total, total, hasDownwardOverride };
}

function describeOverride(
  catalogPrice: number,
  actualPrice: number,
  reason: string | null,
): BuiltOrderLine['override'] {
  if (actualPrice === catalogPrice) {
    return null;
  }
  const trimmed = (reason ?? '').trim();
  if (!trimmed) {
    throw new CommerceError(
      'override-reason-required',
      'Price changes need a reason so the audit trail stays explicit.',
    );
  }
  return { catalogPrice, actualPrice, difference: actualPrice - catalogPrice, reason: trimmed };
}

/**
 * Reject client-submitted totals that disagree with the server computation.
 * Clients may omit the total; they may never dictate it.
 */
export function assertClientTotal(serverTotal: number, clientTotal: number | null | undefined): void {
  if (clientTotal === null || clientTotal === undefined) {
    return;
  }
  if (!Number.isFinite(clientTotal) || clientTotal !== serverTotal) {
    throw new CommerceError(
      'total-mismatch',
      'The submitted total does not match the server-computed total.',
    );
  }
}

// ── Review routing ───────────────────────────────────────────────────────────

export type ReviewRoute = 'PENDING_REVIEW' | 'AUTO_APPROVE';

/**
 * Decide whether a submitted order needs human review. Policy inputs are
 * explicit — never buried in frontend behaviour:
 * - customer bookings follow the merchant `orderReviewRequired` flag,
 * - staff downward overrides always need admin review,
 * - admin overrides are audited but never block on themselves.
 */
export function routeNewOrder(input: {
  source: OrderSource;
  creatorRole: 'shop_admin' | 'staff' | 'super_admin' | 'customer' | 'system';
  hasDownwardOverride: boolean;
  orderReviewRequired: boolean;
}): ReviewRoute {
  if (input.source === 'CUSTOMER_BOOKING') {
    return input.orderReviewRequired ? 'PENDING_REVIEW' : 'AUTO_APPROVE';
  }
  if (input.hasDownwardOverride && input.creatorRole === 'staff') {
    return 'PENDING_REVIEW';
  }
  return 'AUTO_APPROVE';
}

// ── Legacy mapping (service_record → sale snapshot) ──────────────────────────

export type LegacyServiceRecordView = {
  id: string;
  tenantId: string;
  customerId: string;
  staffId: string;
  serviceId: string | null;
  serviceName: string;
  isCustomService: boolean;
  price: number;
  description?: string;
  commissionType: 'fixed' | 'percentage';
  commissionValue: number;
  commissionAmount: number;
  performedAt: string;
  recordedBy: string;
  correctedAt?: string | null;
  correctedBy?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  createdAt: string;
};

/**
 * Map a historical service record to a sale snapshot. Catalog and actual
 * prices both equal the recorded price; override history is unknowable and
 * flagged rather than fabricated. Commission, attribution, names and
 * correction/void metadata are preserved verbatim.
 */
export function mapServiceRecordToSaleSnapshot(record: LegacyServiceRecordView): {
  customerId: string;
  sellerId: string;
  subtotal: number;
  total: number;
  items: {
    kind: 'service';
    productId: null;
    serviceId: string | null;
    quantity: number;
    catalogUnitPrice: number;
    actualUnitPrice: number;
    lineTotal: number;
    itemName: string;
    commissionType: 'fixed' | 'percentage';
    commissionValue: number;
    commissionAmount: number;
    overrideHistoryUnknown: boolean;
  }[];
  status: SaleStatus;
  voidedAt: string | null;
  voidedBy: string | null;
  voidReason: string | null;
} {
  return {
    customerId: record.customerId,
    sellerId: record.staffId,
    subtotal: record.price,
    total: record.price,
    items: [
      {
        kind: 'service',
        productId: null,
        serviceId: record.serviceId,
        quantity: 1,
        catalogUnitPrice: record.price,
        actualUnitPrice: record.price,
        lineTotal: record.price,
        itemName: record.serviceName,
        commissionType: record.commissionType,
        commissionValue: record.commissionValue,
        commissionAmount: record.commissionAmount,
        overrideHistoryUnknown: true,
      },
    ],
    status: record.voidedAt ? 'VOIDED' : 'COMPLETED',
    voidedAt: record.voidedAt ?? null,
    voidedBy: record.voidedBy ?? null,
    voidReason: record.voidReason ?? null,
  };
}
