/**
 * Legacy sale projection (engine sale → service_record read model).
 *
 * Every statistics surface (dashboard, monthly reports, financial rows, staff
 * performance, the sales ledger page) aggregates `serviceRecords` — never the
 * engine `sales` table. Engine-finalized sales therefore stay invisible to
 * statistics unless they carry a `commerceSaleId`-linked legacy record.
 *
 * Both salon flows co-write this projection inline (price-list entry, booking
 * approval). Repository-finalized sales (seller QR, admin UI orders, payment
 * settlement) had no projection: approved, stock-moving sales that statistics
 * never saw. This module is the single canonical implementation for those
 * paths. Callers invoke it inside the SAME mutator/transaction as the engine
 * finalize, so sale, stock and statistics projection commit atomically.
 *
 * Idempotency: the `commerceSaleId` link is the guard. A sale that already
 * has a linked record projects to null (re-approval, retries and
 * double-submits never duplicate the statistics contribution).
 *
 * The builder is infallible by construction — every lookup degrades to a
 * neutral default — so a read-model concern can never block a sale commit.
 *
 * Operates on minimal structural types so the matrix runs under `node --test`.
 */

import { randomUUID } from 'node:crypto';

import { calculateCommerceCommission } from './commission.ts';

export type ProjectionSale = {
  id: string;
  tenantId: string;
  customerId?: string | null;
  sellerId?: string | null;
  total: number;
  completedAt?: string | null;
};

export type ProjectionItem = {
  itemType: 'PRODUCT' | 'SERVICE';
  productId?: string | null;
  serviceId?: string | null;
  quantity: number;
  itemName: string;
  itemSnapshot?: Record<string, unknown> | null;
};

export type ProjectionUser = {
  id: string;
  tenantId: string | null;
  fullName?: string | null;
  commissionType?: 'fixed' | 'percentage' | null;
  commissionValue?: number | null;
};

export type ProjectionProduct = {
  id: string;
  tenantId: string;
  unitCost?: number | null;
};

export type ProjectionService = {
  id: string;
  tenantId: string;
  commissionType: 'fixed' | 'percentage';
  commissionValue: number;
};

export type ProjectionStore = {
  serviceRecords: { id: string; tenantId: string; commerceSaleId?: string | null }[];
  users: ProjectionUser[];
  products: ProjectionProduct[];
  services: ProjectionService[];
};

export type ProjectedUsage = {
  productId: string;
  quantity: number;
  unitCost: number;
};

export type ProjectedRecord = {
  id: string;
  tenantId: string;
  customerId: string;
  staffId: string;
  serviceId?: string | null;
  serviceName: string;
  isCustomService: boolean;
  price: number;
  description?: string;
  commissionType: 'fixed' | 'percentage';
  commissionValue: number;
  commissionAmount: number;
  productUsages: ProjectedUsage[];
  performedAt: string;
  recordedBy: string;
  correctedAt?: string | null;
  correctedBy?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  voidReason?: string | null;
  idempotencyKey?: string | null;
  commerceSaleId?: string | null;
  createdAt: string;
};

/** Reuse the BOM consumption the engine already snapshotted at finalize time. */
function readConsumedProducts(itemSnapshot: Record<string, unknown> | null | undefined): { productId: string; quantity: number }[] {
  const raw = itemSnapshot?.['consumedProducts'];
  if (!Array.isArray(raw)) {
    return [];
  }
  const lines: { productId: string; quantity: number }[] = [];
  for (const entry of raw) {
    const record = (entry ?? {}) as Record<string, unknown>;
    if (typeof record['productId'] !== 'string' || !record['productId']) {
      continue;
    }
    const quantity = Number(record['quantity']);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }
    lines.push({ productId: record['productId'], quantity });
  }
  return lines;
}

/**
 * Project a freshly finalized engine sale into the legacy read model.
 * Returns the appended record, or null when the sale is already projected.
 * Never throws: unknown sellers, products and services degrade to neutral
 * defaults while money (price) and the sale link are always preserved.
 */
export function projectCompletedSaleToLegacyRecord(
  store: ProjectionStore,
  input: {
    sale: ProjectionSale;
    orderNotes?: string | null;
    items: ProjectionItem[];
    actorId: string;
    generateId?: () => string;
    now?: string;
  },
): ProjectedRecord | null {
  const { sale } = input;
  const alreadyProjected = (store.serviceRecords ?? []).some(
    (record) => record.tenantId === sale.tenantId && record.commerceSaleId === sale.id,
  );
  if (alreadyProjected) {
    return null;
  }

  const now = input.now ?? new Date().toISOString();
  const generateId = input.generateId ?? randomUUID;
  const items = Array.isArray(input.items) ? input.items : [];
  const total = Number.isFinite(sale.total) ? (sale.total as number) : 0;

  const seller = (store.users ?? []).find(
    (user) => user.id === sale.sellerId && (user.tenantId === null || user.tenantId === sale.tenantId),
  ) ?? null;

  const serviceLines = items.filter((item) => item.itemType === 'SERVICE' && typeof item.serviceId === 'string' && item.serviceId);
  const singleService =
    items.length === 1 && serviceLines.length === 1
      ? ((store.services ?? []).find((service) => service.id === serviceLines[0].serviceId && service.tenantId === sale.tenantId) ?? null)
      : null;

  const commission = calculateCommerceCommission({
    service: singleService ? { commissionType: singleService.commissionType, commissionValue: singleService.commissionValue } : null,
    staff: seller ? { commissionType: seller.commissionType ?? null, commissionValue: seller.commissionValue ?? null } : null,
    price: total,
  });

  const unitCostOf = (productId: string): number => {
    const product = (store.products ?? []).find((item) => item.id === productId && item.tenantId === sale.tenantId) ?? null;
    const unitCost = Number(product?.unitCost);
    return Number.isFinite(unitCost) ? unitCost : 0;
  };

  const productUsages: ProjectedUsage[] = [];
  for (const item of items) {
    const quantity = Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }
    if (item.itemType === 'PRODUCT' && typeof item.productId === 'string' && item.productId) {
      productUsages.push({ productId: item.productId, quantity, unitCost: unitCostOf(item.productId) });
      continue;
    }
    if (item.itemType === 'SERVICE') {
      for (const consumed of readConsumedProducts(item.itemSnapshot)) {
        productUsages.push({ productId: consumed.productId, quantity: consumed.quantity, unitCost: unitCostOf(consumed.productId) });
      }
    }
  }

  const serviceName =
    items
      .map((item) => `${typeof item.itemName === 'string' && item.itemName ? item.itemName : 'Item'} × ${Number.isFinite(Number(item.quantity)) ? item.quantity : 1}`)
      .join(' · ') || 'Sale';

  const record: ProjectedRecord = {
    id: generateId(),
    tenantId: sale.tenantId,
    customerId: typeof sale.customerId === 'string' && sale.customerId ? sale.customerId : '',
    staffId: typeof sale.sellerId === 'string' && sale.sellerId ? sale.sellerId : input.actorId,
    serviceId: singleService ? singleService.id : null,
    serviceName,
    isCustomService: !singleService,
    price: total,
    description: typeof input.orderNotes === 'string' && input.orderNotes.trim() ? input.orderNotes.trim() : undefined,
    commissionType: commission.commissionType,
    commissionValue: commission.commissionValue,
    commissionAmount: commission.commissionAmount,
    productUsages,
    performedAt: typeof sale.completedAt === 'string' && sale.completedAt ? sale.completedAt : now,
    recordedBy: input.actorId,
    correctedAt: null,
    correctedBy: null,
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    idempotencyKey: `sale-${sale.id}`,
    commerceSaleId: sale.id,
    createdAt: typeof sale.completedAt === 'string' && sale.completedAt ? sale.completedAt : now,
  };

  store.serviceRecords.push(record as ProjectionStore['serviceRecords'][number]);
  return record;
}
