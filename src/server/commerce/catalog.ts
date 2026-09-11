/**
 * Merchant-wide catalog validation + unified read model (Phase 1).
 *
 * Products and Services are merchant-wide entities — no salon-specific fields
 * live here. Salon/retail/barber differences are expressed through names,
 * categories and the optional service BOM, never through core columns.
 *
 * Dependency-free: runs under `node --test` without the Next.js runtime.
 */

import {
  SaleValidationError,
  parseMoneyInput,
  parseOptionalMoneyInput,
  parseProductQuantityInput,
  requireDisplayName,
} from './sale-validation.ts';

const SKU_PATTERN = /^[A-Z0-9][A-Z0-9-_]{0,63}$/;

/** Normalise a merchant SKU. Empty input resolves to null (SKU is optional). */
export function normalizeSku(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (!text) {
    return null;
  }
  if (!SKU_PATTERN.test(text)) {
    throw new SaleValidationError(
      'invalid-sku',
      'sku',
      'SKU may only contain letters, numbers, hyphens and underscores (max 64 characters).',
    );
  }
  return text;
}

/** Generate a placeholder SKU, explicitly flagged so merchants replace it. */
export function generateSku(randomHex: string): { sku: string; skuGenerated: true } {
  const suffix = randomHex.replace(/[^a-f0-9]/gi, '').slice(0, 8).toUpperCase().padEnd(8, '0');
  return { sku: `SKU-${suffix}`, skuGenerated: true };
}

export type ValidatedThresholds = {
  reorderLevel: number | null;
  criticalLevel: number | null;
};

/** Parse optional stock thresholds. `critical <= reorder` is enforced. */
export function parseThresholds(raw: { reorderLevel?: unknown; criticalLevel?: unknown }): ValidatedThresholds {
  const reorderText = typeof raw.reorderLevel === 'string' ? raw.reorderLevel.trim() : '';
  const criticalText = typeof raw.criticalLevel === 'string' ? raw.criticalLevel.trim() : '';
  const reorderLevel = reorderText ? parseProductQuantityInput(reorderText, 'reorderLevel') : null;
  const criticalLevel = criticalText ? parseProductQuantityInput(criticalText, 'criticalLevel') : null;

  if (reorderLevel !== null && criticalLevel !== null && criticalLevel > reorderLevel) {
    throw new SaleValidationError(
      'invalid-threshold',
      'criticalLevel',
      'Critical level cannot be higher than the reorder level.',
    );
  }

  return { reorderLevel, criticalLevel };
}

export type ProductInput = {
  name: unknown;
  description?: unknown;
  sku?: unknown;
  unitCost: unknown;
  /** Absent/empty selling price resolves to null = `needs_pricing`. */
  sellingPrice?: unknown;
  reorderLevel?: unknown;
  criticalLevel?: unknown;
};

export type ValidatedProductInput = {
  name: string;
  description: string;
  sku: string | null;
  unitCost: number;
  sellingPrice: number | null;
  reorderLevel: number | null;
  criticalLevel: number | null;
  needsPricing: boolean;
};

export function validateProductInput(input: ProductInput): ValidatedProductInput {
  const name = requireDisplayName(typeof input.name === 'string' ? input.name : '', 'name');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const unitCost = parseMoneyInput(input.unitCost, 'unitCost');
  const sellingPrice = parseOptionalMoneyInput(input.sellingPrice ?? null, 'sellingPrice');
  const { reorderLevel, criticalLevel } = parseThresholds({
    reorderLevel: input.reorderLevel,
    criticalLevel: input.criticalLevel,
  });

  return {
    name,
    description,
    sku: normalizeSku(input.sku),
    unitCost,
    sellingPrice,
    reorderLevel,
    criticalLevel,
    needsPricing: sellingPrice === null,
  };
}

/**
 * Assert SKU uniqueness within the tenant's catalog (case-insensitive).
 * Null SKUs are exempt — uncatalogued legacy rows never collide.
 */
export function assertSkuUnique(
  products: { id: string; tenantId: string; sku?: string | null }[],
  tenantId: string,
  sku: string | null,
  excludeProductId?: string | null,
): void {
  if (!sku) {
    return;
  }
  const clash = products.some(
    (product) =>
      product.tenantId === tenantId &&
      product.id !== excludeProductId &&
      (product.sku ?? '').toUpperCase() === sku.toUpperCase(),
  );
  if (clash) {
    throw new SaleValidationError('duplicate-sku', 'sku', 'Another product in this shop already uses that SKU.');
  }
}

export type ServiceInput = {
  name: unknown;
  description?: unknown;
  price: unknown;
  durationMinutes?: unknown;
  commissionType?: unknown;
  commissionValue?: unknown;
};

export type ValidatedServiceInput = {
  name: string;
  description: string;
  price: number;
  durationMinutes: number | undefined;
  commissionType: 'fixed' | 'percentage';
  commissionValue: number;
};

export function validateServiceInput(input: ServiceInput): ValidatedServiceInput {
  const name = requireDisplayName(typeof input.name === 'string' ? input.name : '', 'name');
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const price = parseMoneyInput(input.price, 'price');
  const durationRaw = typeof input.durationMinutes === 'string' ? input.durationMinutes.trim() : '';
  const durationParsed = durationRaw ? parseProductQuantityInput(durationRaw, 'durationMinutes') : 0;
  const commissionType = input.commissionType === 'fixed' ? 'fixed' : 'percentage';
  const commissionValue = parseOptionalMoneyInput(input.commissionValue ?? 0, 'commissionValue') ?? 0;

  return {
    name,
    description,
    price,
    durationMinutes: durationParsed > 0 ? durationParsed : undefined,
    commissionType,
    commissionValue,
  };
}

// ── Unified merchant catalog read model ──────────────────────────────────────
// Answers "what can this merchant sell?" without exposing the product/service
// split to future checkout surfaces.

export type CatalogItemType = 'product' | 'service';

export type CatalogItem = {
  id: string;
  tenantId: string;
  type: CatalogItemType;
  name: string;
  /** Products without a selling price expose null (needs_pricing). */
  catalogPrice: number | null;
  isActive: boolean;
  sku: string | null;
  /** Null for services — services never carry stock. */
  quantityOnHand: number | null;
};

export function buildCatalogReadModel(input: {
  tenantId: string;
  products: {
    id: string;
    tenantId: string;
    name: string;
    sellingPrice?: number | null;
    quantityOnHand?: number | null;
    sku?: string | null;
    isActive: boolean;
  }[];
  services: {
    id: string;
    tenantId: string;
    name: string;
    price: number;
    isActive: boolean;
  }[];
  includeInactive?: boolean;
}): CatalogItem[] {
  const items: CatalogItem[] = [];

  for (const product of input.products) {
    if (product.tenantId !== input.tenantId) {
      continue;
    }
    if (!input.includeInactive && !product.isActive) {
      continue;
    }
    items.push({
      id: product.id,
      tenantId: product.tenantId,
      type: 'product',
      name: product.name,
      catalogPrice: product.sellingPrice ?? null,
      isActive: product.isActive,
      sku: product.sku ?? null,
      quantityOnHand: product.quantityOnHand ?? 0,
    });
  }

  for (const service of input.services) {
    if (service.tenantId !== input.tenantId) {
      continue;
    }
    if (!input.includeInactive && !service.isActive) {
      continue;
    }
    items.push({
      id: service.id,
      tenantId: service.tenantId,
      type: 'service',
      name: service.name,
      catalogPrice: service.price,
      isActive: service.isActive,
      sku: null,
      quantityOnHand: null,
    });
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}
