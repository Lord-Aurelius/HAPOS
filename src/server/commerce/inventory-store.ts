/**
 * Inventory persistence operations over the transitional file projection
 * (Phase 1, unit 5a).
 *
 * Single implementation rule: this module owns ALL stock-changing semantics.
 * The future SQL adapter will call the same pure engine (`inventory.ts`) with
 * row-level transactions; the file projection below applies the identical
 * engine inside one `updateStore` mutator. There is exactly one engine.
 *
 * `ensureCatalogProjection` is also called by `migrateStoreState` in
 * `src/server/store/index.ts`, so migration backfill and these tests exercise
 * the same code path.
 */

import { randomUUID } from 'node:crypto';

import {
  InventoryError,
  applyMovement,
  planAdjustment,
  resolveServiceConsumption,
  type InventoryMovementType,
} from './inventory.ts';
import { SaleValidationError } from './sale-validation.ts';

// ── Minimal structural store (real StoreState is assignable) ─────────────────

export type ProjectionProduct = {
  id: string;
  tenantId: string;
  unitCost?: number;
  quantityOnHand?: number;
  isActive?: boolean;
};

export type ProjectionService = {
  id: string;
  tenantId: string;
  isActive?: boolean;
};

export type ProjectionLink = {
  id: string;
  tenantId: string;
  serviceId: string;
  productId: string;
  quantity: number;
  createdAt: string;
};

export type ProjectionMovement = {
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

export type ProjectionCatalogProduct = ProjectionProduct & {
  sku?: string | null;
  skuGenerated?: boolean;
  sellingPrice?: number | null;
  reorderLevel?: number | null;
  criticalLevel?: number | null;
};

export type ProjectionStore = {
  products: ProjectionCatalogProduct[];
  services: ProjectionService[];
  serviceProductLinks?: ProjectionLink[];
  inventoryMovements?: ProjectionMovement[];
};

export type IdGenerator = () => string;

// ── Migration backfill (shared with migrateStoreState) ───────────────────────

export function ensureCatalogProjection(store: ProjectionStore): { changed: boolean } {
  let changed = false;

  if (!Array.isArray(store.serviceProductLinks)) {
    store.serviceProductLinks = [];
    changed = true;
  }

  if (!Array.isArray(store.inventoryMovements)) {
    store.inventoryMovements = [];
    changed = true;
  }

  for (const product of store.products) {
    if (!('sku' in product)) {
      product.sku = null;
      changed = true;
    }
    if (!('skuGenerated' in product)) {
      product.skuGenerated = false;
      changed = true;
    }
    if (!('sellingPrice' in product)) {
      product.sellingPrice = null;
      changed = true;
    }
    if (!('quantityOnHand' in product)) {
      product.quantityOnHand = 0;
      changed = true;
    }
    if (!('reorderLevel' in product)) {
      product.reorderLevel = null;
      changed = true;
    }
    if (!('criticalLevel' in product)) {
      product.criticalLevel = null;
      changed = true;
    }
  }

  return { changed };
}

// ── Operations (call inside one atomic mutator) ──────────────────────────────

export function requireTenantProduct(
  store: ProjectionStore,
  tenantId: string,
  productId: string,
): ProjectionCatalogProduct {
  const product = store.products.find((item) => item.id === productId && item.tenantId === tenantId) ?? null;
  if (!product) {
    throw new SaleValidationError('unknown-product', 'productId', 'Product not found for this shop.');
  }
  return product;
}

export function requireTenantService(
  store: ProjectionStore,
  tenantId: string,
  serviceId: string,
): ProjectionService {
  const service = store.services.find((item) => item.id === serviceId && item.tenantId === tenantId) ?? null;
  if (!service) {
    throw new SaleValidationError('missing-id', 'serviceId', 'Service not found for this shop.');
  }
  return service;
}

export type PostMovementInput = {
  tenantId: string;
  productId: string;
  type: InventoryMovementType;
  quantity: number;
  referenceType?: string | null;
  referenceId?: string | null;
  unitCost?: number | null;
  reason?: string | null;
  createdBy?: string | null;
};

export function postInventoryMovement(
  store: ProjectionStore,
  input: PostMovementInput,
  options: { allowNegative?: boolean; generateId?: IdGenerator; now?: string } = {},
): ProjectionMovement {
  const generateId = options.generateId ?? randomUUID;
  const product = requireTenantProduct(store, input.tenantId, input.productId);
  const previousQuantity = product.quantityOnHand ?? 0;
  const application = applyMovement(
    previousQuantity,
    { type: input.type, quantity: input.quantity },
    { allowNegative: options.allowNegative },
  );

  const movement: ProjectionMovement = {
    id: generateId(),
    tenantId: input.tenantId,
    productId: product.id,
    quantity: input.quantity,
    movementType: input.type,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    unitCost: input.unitCost ?? product.unitCost ?? null,
    previousQuantity: application.previousQuantity,
    resultingQuantity: application.resultingQuantity,
    reason: input.reason ?? null,
    createdBy: input.createdBy ?? null,
    createdAt: options.now ?? new Date().toISOString(),
  };

  store.inventoryMovements ??= [];
  store.inventoryMovements.push(movement);
  product.quantityOnHand = application.resultingQuantity;
  return movement;
}

/** Opening stock. Rejected when the product already holds stock (use adjustment). */
export function postOpeningBalance(
  store: ProjectionStore,
  input: Omit<PostMovementInput, 'type' | 'quantity'> & { quantity: number },
  options: { generateId?: IdGenerator; now?: string } = {},
): ProjectionMovement {
  const product = requireTenantProduct(store, input.tenantId, input.productId);
  if ((product.quantityOnHand ?? 0) !== 0) {
    throw new InventoryError(
      'no-change',
      'Opening balance is already recorded for this product. Record an adjustment instead.',
    );
  }
  return postInventoryMovement(store, { ...input, type: 'OPENING_BALANCE' }, options);
}

/** Counted-stock correction. Never assigns quantity directly. */
export function adjustProductStock(
  store: ProjectionStore,
  input: {
    tenantId: string;
    productId: string;
    countedQuantity: number;
    reason?: string | null;
    createdBy?: string | null;
  },
  options: { generateId?: IdGenerator; now?: string } = {},
): ProjectionMovement {
  const product = requireTenantProduct(store, input.tenantId, input.productId);
  const plan = planAdjustment(product.quantityOnHand ?? 0, input.countedQuantity);
  return postInventoryMovement(
    store,
    {
      tenantId: input.tenantId,
      productId: product.id,
      type: 'ADJUSTMENT',
      quantity: plan.quantity,
      reason: input.reason ?? null,
      createdBy: input.createdBy ?? null,
    },
    options,
  );
}

/**
 * Post consumption for a completed service (one SERVICE_CONSUMPTION movement
 * per BOM line). Resolving the BOM alone moves nothing — this function is the
 * only path from definition to stock change, and only a future sale calls it.
 */
export function consumeServiceBom(
  store: ProjectionStore,
  input: {
    tenantId: string;
    serviceId: string;
    times?: number;
    referenceType?: string | null;
    referenceId?: string | null;
    createdBy?: string | null;
  },
  options: { allowNegative?: boolean; generateId?: IdGenerator; now?: string } = {},
): ProjectionMovement[] {
  requireTenantService(store, input.tenantId, input.serviceId);
  const lines = resolveServiceConsumption(
    (store.serviceProductLinks ?? []).map((link) => ({
      serviceId: link.serviceId,
      tenantId: link.tenantId,
      productId: link.productId,
      quantity: link.quantity,
    })),
    input.tenantId,
    input.serviceId,
    input.times ?? 1,
  );

  return lines.map((line) =>
    postInventoryMovement(
      store,
      {
        tenantId: input.tenantId,
        productId: line.productId,
        type: 'SERVICE_CONSUMPTION',
        quantity: -line.quantity,
        referenceType: input.referenceType ?? 'service_completion',
        referenceId: input.referenceId ?? input.serviceId,
        createdBy: input.createdBy ?? null,
      },
      options,
    ),
  );
}

export type BomLineInput = {
  productId: string;
  quantity: number;
};

/** Replace a service's consumption definition (admin). Moves no stock. */
export function replaceServiceBom(
  store: ProjectionStore,
  input: { tenantId: string; serviceId: string; lines: BomLineInput[]; createdBy?: string | null },
  options: { generateId?: IdGenerator; now?: string } = {},
): ProjectionLink[] {
  requireTenantService(store, input.tenantId, input.serviceId);
  const generateId = options.generateId ?? randomUUID;
  const now = options.now ?? new Date().toISOString();

  const validated = input.lines.map((line) => {
    requireTenantProduct(store, input.tenantId, line.productId);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new SaleValidationError(
        'invalid-quantity',
        'quantity',
        'Each consumed product needs a positive whole-number quantity.',
      );
    }
    return line;
  });

  store.serviceProductLinks ??= [];
  store.serviceProductLinks = store.serviceProductLinks.filter(
    (link) => !(link.tenantId === input.tenantId && link.serviceId === input.serviceId),
  );

  const links = validated.map((line) => ({
    id: generateId(),
    tenantId: input.tenantId,
    serviceId: input.serviceId,
    productId: line.productId,
    quantity: line.quantity,
    createdAt: now,
  }));
  store.serviceProductLinks.push(...links);
  return links;
}
