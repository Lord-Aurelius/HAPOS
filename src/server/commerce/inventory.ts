/**
 * Auditable inventory engine (Phase 1).
 *
 * Model: `inventory_movements` is the authoritative history;
 * `quantity_on_hand` is a maintained balance/cache. Every stock-changing
 * operation appends exactly one movement AND updates the balance atomically
 * (same DB transaction in postgres mode, same `updateStore` mutator in file
 * mode). Direct `product.quantity = X` writes are prohibited — adjustments
 * are movements with a computed delta.
 *
 * Default negative-stock policy: reject. An explicit `allowNegative: true`
 * opt-in exists for a future admin-configured policy; nothing in Phase 1
 * passes it.
 *
 * Dependency-free: runs under `node --test` without the Next.js runtime.
 */

export type InventoryMovementType =
  | 'OPENING_BALANCE'
  | 'PURCHASE'
  | 'SALE'
  | 'SERVICE_CONSUMPTION'
  | 'RETURN'
  | 'ADJUSTMENT'
  | 'DAMAGE'
  | 'LOSS'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'MIGRATED_USAGE';

export type InventoryErrorCode = 'zero-quantity' | 'invalid-sign' | 'negative-stock' | 'no-change';

export class InventoryError extends Error {
  readonly code: InventoryErrorCode;

  constructor(code: InventoryErrorCode, message: string) {
    super(message);
    this.name = 'InventoryError';
    this.code = code;
  }
}

/** Movement types that must carry a positive delta (stock in). */
const POSITIVE_TYPES: ReadonlySet<InventoryMovementType> = new Set([
  'OPENING_BALANCE',
  'PURCHASE',
  'RETURN',
  'TRANSFER_IN',
]);

/** Movement types that must carry a negative delta (stock out). */
const NEGATIVE_TYPES: ReadonlySet<InventoryMovementType> = new Set([
  'SALE',
  'SERVICE_CONSUMPTION',
  'DAMAGE',
  'LOSS',
  'TRANSFER_OUT',
]);

/** Types that may carry either sign. */
const SIGNED_TYPES: ReadonlySet<InventoryMovementType> = new Set(['ADJUSTMENT', 'MIGRATED_USAGE']);

export function movementSignExpectation(type: InventoryMovementType): 'positive' | 'negative' | 'signed' {
  if (POSITIVE_TYPES.has(type)) {
    return 'positive';
  }
  if (NEGATIVE_TYPES.has(type)) {
    return 'negative';
  }
  return 'signed';
}

export type MovementApplication = {
  previousQuantity: number;
  resultingQuantity: number;
};

/**
 * Validate a movement delta against its type and compute the resulting
 * balance. Throws on zero deltas, sign violations, and (by default) any
 * outcome that would drive stock negative.
 */
export function applyMovement(
  previousQuantity: number,
  movement: { type: InventoryMovementType; quantity: number },
  options: { allowNegative?: boolean } = {},
): MovementApplication {
  if (!Number.isInteger(movement.quantity) || movement.quantity === 0) {
    throw new InventoryError('zero-quantity', 'Inventory movement quantity must be a non-zero whole number.');
  }

  const expectation = movementSignExpectation(movement.type);
  if (expectation === 'positive' && movement.quantity < 0) {
    throw new InventoryError(
      'invalid-sign',
      `${movement.type} movements must add stock (positive quantity).`,
    );
  }
  if (expectation === 'negative' && movement.quantity > 0) {
    throw new InventoryError(
      'invalid-sign',
      `${movement.type} movements must remove stock (negative quantity).`,
    );
  }

  const resultingQuantity = previousQuantity + movement.quantity;
  if (resultingQuantity < 0 && !options.allowNegative) {
    throw new InventoryError(
      'negative-stock',
      `Insufficient stock: ${previousQuantity} on hand, movement of ${movement.quantity} rejected.`,
    );
  }

  return { previousQuantity, resultingQuantity };
}

export type AdjustmentPlan = {
  quantity: number;
  previousQuantity: number;
  resultingQuantity: number;
};

/**
 * Plan a counted-stock adjustment. The caller supplies the PHYSICAL count;
 * the delta is derived (never assigned directly). Zero-delta adjustments are
 * rejected — history must not accumulate no-op rows.
 */
export function planAdjustment(previousQuantity: number, countedQuantity: number): AdjustmentPlan {
  if (!Number.isInteger(countedQuantity) || countedQuantity < 0) {
    throw new InventoryError('negative-stock', 'Counted quantity must be a whole number of zero or more.');
  }
  const quantity = countedQuantity - previousQuantity;
  if (quantity === 0) {
    throw new InventoryError('no-change', 'Counted quantity matches the recorded balance; no adjustment needed.');
  }
  return { quantity, previousQuantity, resultingQuantity: countedQuantity };
}

/**
 * Verify the stock invariant: balance == opening + sum(movements).
 * Used by tests and the future reconciler.
 */
export function verifyStockInvariant(input: {
  openingQuantity: number;
  movements: { quantity: number }[];
  quantityOnHand: number;
}): { valid: boolean; expected: number } {
  const expected = input.movements.reduce((sum, movement) => sum + movement.quantity, input.openingQuantity);
  return { valid: expected === input.quantityOnHand, expected };
}

// ── Stock availability (single implementation for every screen) ──────────────

export type StockStatus = 'out_of_stock' | 'critical' | 'low' | 'in_stock';

export type StockThresholds = {
  quantityOnHand: number;
  reorderLevel?: number | null;
  criticalLevel?: number | null;
};

/**
 * Precedence (explicit):
 *   quantity <= 0            → OUT_OF_STOCK
 *   critical set, qty <= critical → CRITICAL
 *   reorder set, qty <= reorder   → LOW
 *   otherwise                     → IN_STOCK
 *
 * Boundary values belong to the worse state (`<=`), so an alert fires the
 * moment stock touches the threshold instead of one unit later.
 */
export function getStockStatus(input: StockThresholds): StockStatus {
  if (input.quantityOnHand <= 0) {
    return 'out_of_stock';
  }
  if (input.criticalLevel !== null && input.criticalLevel !== undefined && input.quantityOnHand <= input.criticalLevel) {
    return 'critical';
  }
  if (input.reorderLevel !== null && input.reorderLevel !== undefined && input.quantityOnHand <= input.reorderLevel) {
    return 'low';
  }
  return 'in_stock';
}

// ── Service consumption (BOM) ────────────────────────────────────────────────
// A definition only: resolving a BOM never moves stock. Consumption movements
// are posted from an actual future sale, one SERVICE_CONSUMPTION movement per
// product line.

export type ServiceConsumptionLink = {
  serviceId: string;
  tenantId: string;
  productId: string;
  quantity: number;
};

export function resolveServiceConsumption(
  links: ServiceConsumptionLink[],
  tenantId: string,
  serviceId: string,
  times = 1,
): { productId: string; quantity: number }[] {
  if (!Number.isInteger(times) || times <= 0) {
    throw new InventoryError('zero-quantity', 'Service completion count must be a positive whole number.');
  }
  return links
    .filter((link) => link.tenantId === tenantId && link.serviceId === serviceId)
    .map((link) => ({ productId: link.productId, quantity: link.quantity * times }));
}
