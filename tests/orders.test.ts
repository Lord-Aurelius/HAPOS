import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CommerceError,
  assertClientTotal,
  buildOrderLines,
  isTerminalOrderStatus,
  mapServiceRecordToSaleSnapshot,
  routeNewOrder,
  transitionOrderStatus,
} from '../src/server/commerce/orders.ts';

function assertCommerceCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof CommerceError && error.code === code,
    `expected CommerceError ${code}`,
  );
}

const products = [
  { id: 'prod-oil', tenantId: 'tenant-a', name: 'Hair Oil', sellingPrice: 800, unitCost: 300, sku: 'OIL-1', isActive: true },
  { id: 'prod-unpriced', tenantId: 'tenant-a', name: 'Mystery', sellingPrice: null, unitCost: 100, sku: null, isActive: true },
  { id: 'prod-retired', tenantId: 'tenant-a', name: 'Old', sellingPrice: 100, unitCost: 50, sku: null, isActive: false },
  { id: 'prod-foreign', tenantId: 'tenant-b', name: 'Foreign', sellingPrice: 10, unitCost: 5, sku: null, isActive: true },
];

const services = [
  { id: 'svc-cut', tenantId: 'tenant-a', name: 'Haircut', price: 250, durationMinutes: 30, commissionType: 'percentage' as const, commissionValue: 10, isActive: true },
  { id: 'svc-paused', tenantId: 'tenant-a', name: 'Paused', price: 500, durationMinutes: 20, commissionType: 'fixed' as const, commissionValue: 100, isActive: false },
  { id: 'svc-foreign', tenantId: 'tenant-b', name: 'Foreign', price: 10, durationMinutes: 10, commissionType: 'percentage' as const, commissionValue: 5, isActive: true },
];

describe('transitionOrderStatus', () => {
  it('allows the review lifecycle', () => {
    assert.equal(transitionOrderStatus('DRAFT', 'SUBMITTED'), 'SUBMITTED');
    assert.equal(transitionOrderStatus('SUBMITTED', 'PENDING_REVIEW'), 'PENDING_REVIEW');
    assert.equal(transitionOrderStatus('PENDING_REVIEW', 'APPROVED'), 'APPROVED');
    assert.equal(transitionOrderStatus('APPROVED', 'COMPLETED'), 'COMPLETED');
  });

  it('allows the auto-approve shortcut and terminal exits', () => {
    assert.equal(transitionOrderStatus('SUBMITTED', 'APPROVED'), 'APPROVED');
    assert.equal(transitionOrderStatus('PENDING_REVIEW', 'REJECTED'), 'REJECTED');
    assert.equal(transitionOrderStatus('DRAFT', 'CANCELLED'), 'CANCELLED');
    assert.equal(transitionOrderStatus('SUBMITTED', 'CANCELLED'), 'CANCELLED');
    assert.equal(transitionOrderStatus('PENDING_REVIEW', 'CANCELLED'), 'CANCELLED');
  });

  it('rejects skips, backwards moves and terminal edits', () => {
    assertCommerceCode(() => transitionOrderStatus('DRAFT', 'APPROVED'), 'invalid-transition');
    assertCommerceCode(() => transitionOrderStatus('PENDING_REVIEW', 'SUBMITTED'), 'invalid-transition');
    assertCommerceCode(() => transitionOrderStatus('APPROVED', 'PENDING_REVIEW'), 'invalid-transition');
    assertCommerceCode(() => transitionOrderStatus('COMPLETED', 'CANCELLED'), 'invalid-transition');
    assertCommerceCode(() => transitionOrderStatus('CANCELLED', 'DRAFT'), 'invalid-transition');
    assertCommerceCode(() => transitionOrderStatus('REJECTED', 'APPROVED'), 'invalid-transition');
    assertCommerceCode(() => transitionOrderStatus('APPROVED', 'REJECTED'), 'invalid-transition');
    assert.equal(isTerminalOrderStatus('COMPLETED'), true);
    assert.equal(isTerminalOrderStatus('DRAFT'), false);
  });
});

describe('buildOrderLines (multi-line cart)', () => {
  it('builds the mixed-cart example with server totals', () => {
    const cart = buildOrderLines({
      tenantId: 'tenant-a',
      products,
      services,
      lines: [
        { kind: 'service', refId: 'svc-cut', quantity: 1 },
        { kind: 'product', refId: 'prod-oil', quantity: 2 },
      ],
    });
    // 1 x 250 + 2 x 800 = 1850.
    assert.equal(cart.lines.length, 2);
    assert.equal(cart.lines[0].lineTotal, 250);
    assert.equal(cart.lines[1].lineTotal, 1600);
    assert.equal(cart.subtotal, 1850);
    assert.equal(cart.total, 1850);
    assert.equal(cart.hasDownwardOverride, false);
  });

  it('supports service-only and product-only carts', () => {
    const serviceOnly = buildOrderLines({
      tenantId: 'tenant-a',
      products,
      services,
      lines: [{ kind: 'service', refId: 'svc-cut', quantity: 1 }],
    });
    assert.equal(serviceOnly.total, 250);
    const productOnly = buildOrderLines({
      tenantId: 'tenant-a',
      products,
      services,
      lines: [{ kind: 'product', refId: 'prod-oil', quantity: 3 }],
    });
    assert.equal(productOnly.total, 2400);
  });

  it('rejects empty carts and bad quantities', () => {
    assertCommerceCode(() => buildOrderLines({ tenantId: 'tenant-a', products, services, lines: [] }), 'empty-order');
    assertCommerceCode(
      () => buildOrderLines({ tenantId: 'tenant-a', products, services, lines: [{ kind: 'product', refId: 'prod-oil', quantity: 0 }] }),
      'invalid-quantity',
    );
    assertCommerceCode(
      () => buildOrderLines({ tenantId: 'tenant-a', products, services, lines: [{ kind: 'product', refId: 'prod-oil', quantity: 1.5 }] }),
      'invalid-quantity',
    );
  });

  it('rejects unknown, cross-tenant, inactive and unpriced items', () => {
    const base = { tenantId: 'tenant-a', products, services };
    assertCommerceCode(
      () => buildOrderLines({ ...base, lines: [{ kind: 'product', refId: 'nope', quantity: 1 }] }),
      'unknown-item',
    );
    assertCommerceCode(
      () => buildOrderLines({ ...base, lines: [{ kind: 'product', refId: 'prod-foreign', quantity: 1 }] }),
      'cross-tenant-item',
    );
    assertCommerceCode(
      () => buildOrderLines({ ...base, lines: [{ kind: 'service', refId: 'svc-foreign', quantity: 1 }] }),
      'cross-tenant-item',
    );
    assertCommerceCode(
      () => buildOrderLines({ ...base, lines: [{ kind: 'product', refId: 'prod-retired', quantity: 1 }] }),
      'inactive-item',
    );
    assertCommerceCode(
      () => buildOrderLines({ ...base, lines: [{ kind: 'service', refId: 'svc-paused', quantity: 1 }] }),
      'inactive-item',
    );
    assertCommerceCode(
      () => buildOrderLines({ ...base, lines: [{ kind: 'product', refId: 'prod-unpriced', quantity: 1 }] }),
      'needs-pricing',
    );
  });
});

describe('price snapshots and overrides', () => {
  it('snapshots catalog prices and freezes them against later edits', () => {
    const first = buildOrderLines({
      tenantId: 'tenant-a',
      products,
      services,
      lines: [{ kind: 'product', refId: 'prod-oil', quantity: 1 }],
    });
    assert.equal(first.lines[0].catalogUnitPrice, 800);
    // Admin reprices the catalog afterwards; the snapshot must not follow.
    const repriced = products.map((product) =>
      product.id === 'prod-oil' ? { ...product, sellingPrice: 950 } : product,
    );
    const second = buildOrderLines({
      tenantId: 'tenant-a',
      products: repriced,
      services,
      lines: [{ kind: 'product', refId: 'prod-oil', quantity: 1 }],
    });
    assert.equal(first.lines[0].catalogUnitPrice, 800);
    assert.equal(second.lines[0].catalogUnitPrice, 950);
  });

  it('records explicit overrides with reason and difference', () => {
    const cart = buildOrderLines({
      tenantId: 'tenant-a',
      products,
      services,
      lines: [{ kind: 'product', refId: 'prod-oil', quantity: 2, actualUnitPrice: 700, overrideReason: 'Loyalty discount' }],
    });
    assert.deepEqual(cart.lines[0].override, {
      catalogPrice: 800,
      actualPrice: 700,
      difference: -100,
      reason: 'Loyalty discount',
    });
    assert.equal(cart.lines[0].lineTotal, 1400);
    assert.equal(cart.hasDownwardOverride, true);
  });

  it('requires a reason for any deviation and rejects bad prices', () => {
    const base = { tenantId: 'tenant-a', products, services };
    assertCommerceCode(
      () => buildOrderLines({ ...base, lines: [{ kind: 'product', refId: 'prod-oil', quantity: 1, actualUnitPrice: 700 }] }),
      'override-reason-required',
    );
    assertCommerceCode(
      () => buildOrderLines({ ...base, lines: [{ kind: 'product', refId: 'prod-oil', quantity: 1, actualUnitPrice: -5, overrideReason: 'x' }] }),
      'invalid-price',
    );
    assertCommerceCode(
      () => buildOrderLines({ ...base, lines: [{ kind: 'product', refId: 'prod-oil', quantity: 1, actualUnitPrice: Number.NaN, overrideReason: 'x' }] }),
      'invalid-price',
    );
  });

  it('snapshots service commission at finalization time', () => {
    const cart = buildOrderLines({
      tenantId: 'tenant-a',
      products,
      services,
      lines: [{ kind: 'service', refId: 'svc-cut', quantity: 2 }],
      staffCommission: { commissionType: 'percentage', commissionValue: 20 },
    });
    // Staff 20% overrides service 10%; 20% of 250 = 50 per unit x2.
    assert.equal(cart.lines[0].commissionType, 'percentage');
    assert.equal(cart.lines[0].commissionValue, 20);
    assert.equal(cart.lines[0].commissionAmount, 100);
  });
});

describe('assertClientTotal', () => {
  it('accepts omitted totals and rejects manipulated ones', () => {
    assert.doesNotThrow(() => assertClientTotal(1850, null));
    assert.doesNotThrow(() => assertClientTotal(1850, undefined));
    assert.doesNotThrow(() => assertClientTotal(1850, 1850));
    assertCommerceCode(() => assertClientTotal(1850, 1700), 'total-mismatch');
    assertCommerceCode(() => assertClientTotal(1850, Number.NaN), 'total-mismatch');
  });
});

describe('routeNewOrder', () => {
  it('sends customer bookings to review by default', () => {
    assert.equal(
      routeNewOrder({ source: 'CUSTOMER_BOOKING', creatorRole: 'customer', hasDownwardOverride: false, orderReviewRequired: true }),
      'PENDING_REVIEW',
    );
    assert.equal(
      routeNewOrder({ source: 'CUSTOMER_BOOKING', creatorRole: 'customer', hasDownwardOverride: false, orderReviewRequired: false }),
      'AUTO_APPROVE',
    );
  });

  it('holds staff discounts for admin review, passes admin overrides', () => {
    assert.equal(
      routeNewOrder({ source: 'STAFF', creatorRole: 'staff', hasDownwardOverride: true, orderReviewRequired: true }),
      'PENDING_REVIEW',
    );
    assert.equal(
      routeNewOrder({ source: 'STAFF', creatorRole: 'staff', hasDownwardOverride: false, orderReviewRequired: true }),
      'AUTO_APPROVE',
    );
    assert.equal(
      routeNewOrder({ source: 'ADMIN', creatorRole: 'shop_admin', hasDownwardOverride: true, orderReviewRequired: true }),
      'AUTO_APPROVE',
    );
  });

  it('forceReview holds orders regardless of source or policy (M-Pesa intent)', () => {
    assert.equal(
      routeNewOrder({ source: 'STAFF', creatorRole: 'staff', hasDownwardOverride: false, orderReviewRequired: false, forceReview: true }),
      'PENDING_REVIEW',
    );
    assert.equal(
      routeNewOrder({ source: 'ADMIN', creatorRole: 'shop_admin', hasDownwardOverride: false, orderReviewRequired: false, forceReview: true }),
      'PENDING_REVIEW',
    );
  });
});

describe('mapServiceRecordToSaleSnapshot', () => {
  it('preserves history without fabricating overrides', () => {
    const snapshot = mapServiceRecordToSaleSnapshot({
      id: 'record-1',
      tenantId: 'tenant-a',
      customerId: 'customer-1',
      staffId: 'staff-1',
      serviceId: 'service-haircut',
      serviceName: 'Signature Haircut',
      isCustomService: false,
      price: 800,
      commissionType: 'percentage',
      commissionValue: 35,
      commissionAmount: 280,
      performedAt: '2026-04-04T07:45:00.000Z',
      recordedBy: 'staff-1',
      correctedAt: null,
      correctedBy: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      createdAt: '2026-04-04T07:45:00.000Z',
    });
    assert.equal(snapshot.total, 800);
    assert.equal(snapshot.items[0].catalogUnitPrice, 800);
    assert.equal(snapshot.items[0].actualUnitPrice, 800);
    assert.equal(snapshot.items[0].overrideHistoryUnknown, true);
    assert.equal(snapshot.items[0].commissionAmount, 280);
    assert.equal(snapshot.status, 'COMPLETED');
  });

  it('maps voided records to voided snapshots with metadata', () => {
    const snapshot = mapServiceRecordToSaleSnapshot({
      id: 'record-2',
      tenantId: 'tenant-a',
      customerId: 'customer-1',
      staffId: 'staff-1',
      serviceId: null,
      serviceName: 'Custom',
      isCustomService: true,
      price: 1000,
      commissionType: 'percentage',
      commissionValue: 10,
      commissionAmount: 100,
      performedAt: '2026-04-04T07:45:00.000Z',
      recordedBy: 'staff-1',
      correctedAt: null,
      correctedBy: null,
      voidedAt: '2026-04-05T00:00:00.000Z',
      voidedBy: 'admin-1',
      voidReason: 'Duplicate',
      createdAt: '2026-04-04T07:45:00.000Z',
    });
    assert.equal(snapshot.status, 'VOIDED');
    assert.equal(snapshot.voidReason, 'Duplicate');
    assert.equal(snapshot.voidedBy, 'admin-1');
  });
});
