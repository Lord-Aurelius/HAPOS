import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  approveOrder,
  cancelOrder,
  createOrder,
  findOrderByIdempotencyKey,
  parseOrderIdempotencyKey,
  rejectOrder,
  requiredStockForItems,
  submitOrder,
  voidSale,
  type CommerceStore,
} from '../src/server/commerce/commerce-store.ts';
import { CommerceError } from '../src/server/commerce/orders.ts';

let sequence = 0;
function generateId() {
  sequence += 1;
  return `commerce-test-${sequence}`;
}

function testStore(): CommerceStore {
  return {
    products: [
      { id: 'prod-oil', tenantId: 'tenant-a', name: 'Hair Oil', sellingPrice: 800, unitCost: 300, sku: 'OIL-1', quantityOnHand: 10, isActive: true },
      { id: 'prod-dye', tenantId: 'tenant-a', name: 'Hair Dye', sellingPrice: 1200, unitCost: 500, sku: 'DYE-1', quantityOnHand: 6, isActive: true },
      { id: 'prod-dev', tenantId: 'tenant-a', name: 'Developer', sellingPrice: 400, unitCost: 150, sku: 'DEV-1', quantityOnHand: 6, isActive: true },
      { id: 'prod-foreign', tenantId: 'tenant-b', name: 'Foreign', sellingPrice: 10, unitCost: 5, sku: null, quantityOnHand: 99, isActive: true },
    ],
    services: [
      { id: 'svc-cut', tenantId: 'tenant-a', name: 'Haircut', price: 250, durationMinutes: 30, commissionType: 'percentage', commissionValue: 10, isActive: true },
      { id: 'svc-color', tenantId: 'tenant-a', name: 'Colour', price: 3000, durationMinutes: 90, commissionType: 'percentage', commissionValue: 15, isActive: true },
    ],
    customers: [{ id: 'customer-1', tenantId: 'tenant-a' }],
    users: [
      { id: 'staff-1', tenantId: 'tenant-a' },
      { id: 'admin-1', tenantId: 'tenant-a' },
    ],
    serviceProductLinks: [
      { id: 'link-dye', tenantId: 'tenant-a', serviceId: 'svc-color', productId: 'prod-dye', quantity: 1 },
      { id: 'link-dev', tenantId: 'tenant-a', serviceId: 'svc-color', productId: 'prod-dev', quantity: 1 },
    ],
    inventoryMovements: [],
    orders: [],
    orderItems: [],
    sales: [],
    saleItems: [],
  };
}

const STAFF = { actorId: 'staff-1', actorRole: 'staff' as const };
const ADMIN = { actorId: 'admin-1', actorRole: 'shop_admin' as const };

describe('createOrder', () => {
  it('creates a draft order with server-computed totals and seller attribution', () => {
    const store = testStore();
    const { order, items, duplicate } = createOrder(
      store,
      {
        tenantId: 'tenant-a',
        customerId: 'customer-1',
        sellerId: 'staff-1',
        source: 'STAFF',
        lines: [
          { kind: 'service', refId: 'svc-cut', quantity: 1 },
          { kind: 'product', refId: 'prod-oil', quantity: 2 },
        ],
        creatorRole: 'staff',
        creatorId: 'staff-1',
        orderReviewRequired: true,
      },
      { generateId },
    );
    assert.equal(duplicate, false);
    assert.equal(order.status, 'DRAFT');
    assert.equal(order.total, 1850);
    assert.equal(order.sellerId, 'staff-1');
    assert.equal(items.length, 2);
    assert.equal(items[0].itemType, 'SERVICE');
    assert.equal(items[1].catalogUnitPrice, 800);
  });

  it('is idempotent on the client key (no duplicate order)', () => {
    const store = testStore();
    const input = {
      tenantId: 'tenant-a',
      sellerId: 'staff-1',
      source: 'STAFF' as const,
      lines: [{ kind: 'service' as const, refId: 'svc-cut', quantity: 1 }],
      idempotencyKey: 'order-key-1',
      creatorRole: 'staff' as const,
      creatorId: 'staff-1',
      orderReviewRequired: true,
    };
    const first = createOrder(store, input, { generateId });
    const retry = createOrder(store, input, { generateId });
    assert.equal(first.duplicate, false);
    assert.equal(retry.duplicate, true);
    assert.equal(retry.order.id, first.order.id);
    assert.equal(store.orders.length, 1);
    assert.equal(store.orderItems.length, 1);
  });

  it('rejects cross-tenant catalog references', () => {
    const store = testStore();
    assert.throws(
      () => createOrder(store, {
        tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
        lines: [{ kind: 'product', refId: 'prod-foreign', quantity: 1 }],
        creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
      }, { generateId }),
      (error: unknown) => error instanceof CommerceError && error.code === 'cross-tenant-item',
    );
  });
});

describe('submitOrder', () => {
  it('auto-approves staff orders without discounts', () => {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'service', refId: 'svc-cut', quantity: 1 }],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    const { route } = submitOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF, orderReviewRequired: true }, { generateId });
    assert.equal(route, 'AUTO_APPROVE');
    assert.equal(order.status, 'APPROVED');
  });

  it('holds staff discounts for review', () => {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'product', refId: 'prod-oil', quantity: 1, actualUnitPrice: 700, overrideReason: 'Loyalty' }],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    const { route } = submitOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF, orderReviewRequired: true }, { generateId });
    assert.equal(route, 'PENDING_REVIEW');
    assert.equal(order.status, 'PENDING_REVIEW');
  });

  it('rejects double submission', () => {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'service', refId: 'svc-cut', quantity: 1 }],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    submitOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF, orderReviewRequired: true }, { generateId });
    assert.throws(
      () => submitOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF, orderReviewRequired: true }, { generateId }),
      (error: unknown) => error instanceof CommerceError && error.code === 'invalid-transition',
    );
  });
});

describe('approveOrder (approval creates exactly one sale)', () => {
  function approvedMixedOrder() {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', customerId: 'customer-1', sellerId: 'staff-1', source: 'STAFF',
      lines: [
        { kind: 'service', refId: 'svc-color', quantity: 1 },
        { kind: 'product', refId: 'prod-oil', quantity: 2 },
      ],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    submitOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF, orderReviewRequired: true }, { generateId });
    return { store, order };
  }

  it('finalizes the sale, posts product + BOM movements atomically', () => {
    const { store, order } = approvedMixedOrder();
    const { sale, duplicate } = approveOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...ADMIN }, { generateId });
    assert.equal(duplicate, false);
    assert.equal(sale.status, 'COMPLETED');
    assert.equal(sale.total, 3000 + 1600);
    assert.equal(sale.sellerId, 'staff-1');
    assert.equal(order.status, 'COMPLETED');

    // 2 oil sold + 1 dye + 1 developer consumed.
    assert.equal(store.products.find((p) => p.id === 'prod-oil')?.quantityOnHand, 8);
    assert.equal(store.products.find((p) => p.id === 'prod-dye')?.quantityOnHand, 5);
    assert.equal(store.products.find((p) => p.id === 'prod-dev')?.quantityOnHand, 5);

    const movements = store.inventoryMovements ?? [];
    assert.equal(movements.length, 3);
    assert.ok(movements.every((movement) => movement.referenceId === sale.id));
    assert.ok(movements.some((movement) => movement.movementType === 'SALE' && movement.quantity === -2));
    assert.ok(movements.some((movement) => movement.movementType === 'SERVICE_CONSUMPTION'));

    // Sale items carry snapshots incl. consumed BOM lines and commission.
    const colorItem = store.saleItems.find((item) => item.serviceId === 'svc-color');
    assert.equal(colorItem?.commissionAmount, 450);
    assert.deepEqual(colorItem?.itemSnapshot, {
      durationMinutes: 90,
      consumedProducts: [
        { productId: 'prod-dye', quantity: 1 },
        { productId: 'prod-dev', quantity: 1 },
      ],
    });
  });

  it('re-approval returns the original sale (no duplicate)', () => {
    const { store, order } = approvedMixedOrder();
    const first = approveOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...ADMIN }, { generateId });
    const retry = approveOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...ADMIN }, { generateId });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.sale.id, first.sale.id);
    assert.equal(store.sales.length, 1);
    assert.equal((store.inventoryMovements ?? []).length, 3);
  });

  it('forbids staff approval of pending orders', () => {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'product', refId: 'prod-oil', quantity: 1, actualUnitPrice: 700, overrideReason: 'Loyalty' }],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    submitOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF, orderReviewRequired: true }, { generateId });
    assert.equal(order.status, 'PENDING_REVIEW');
    assert.throws(
      () => approveOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF }, { generateId }),
      (error: unknown) => error instanceof CommerceError && error.code === 'not-permitted',
    );
  });

  it('blocks the entire sale on insufficient stock (nothing deducted)', () => {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [
        { kind: 'product', refId: 'prod-oil', quantity: 2 },
        { kind: 'product', refId: 'prod-dye', quantity: 99 },
      ],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    submitOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF, orderReviewRequired: true }, { generateId });
    assert.throws(
      () => approveOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...ADMIN }, { generateId }),
      (error: unknown) => error instanceof CommerceError && error.code === 'insufficient-stock',
    );
    // Atomic: sale missing AND inventory unchanged.
    assert.equal(store.sales.length, 0);
    assert.equal(store.products.find((p) => p.id === 'prod-oil')?.quantityOnHand, 10);
    assert.equal((store.inventoryMovements ?? []).length, 0);
    assert.equal(order.status, 'APPROVED');
  });

  it('a service without BOM posts no movement', () => {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'service', refId: 'svc-cut', quantity: 1 }],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    submitOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF, orderReviewRequired: true }, { generateId });
    approveOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...ADMIN }, { generateId });
    assert.equal((store.inventoryMovements ?? []).length, 0);
  });
});

describe('requiredStockForItems', () => {
  it('aggregates product lines and BOM consumption per product', () => {
    const store = testStore();
    const requirements = requiredStockForItems(store.serviceProductLinks ?? [], 'tenant-a', [
      { itemType: 'PRODUCT', productId: 'prod-oil', quantity: 2 },
      { itemType: 'SERVICE', serviceId: 'svc-color', quantity: 2 },
    ]);
    const map = new Map(requirements.map((r) => [r.productId, r.quantity]));
    assert.equal(map.get('prod-oil'), 2);
    assert.equal(map.get('prod-dye'), 2);
    assert.equal(map.get('prod-dev'), 2);
  });
});

describe('rejectOrder / cancelOrder', () => {
  it('rejects pending orders with a reason (admin only)', () => {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'CUSTOMER_BOOKING',
      lines: [{ kind: 'service', refId: 'svc-cut', quantity: 1 }],
      creatorRole: 'customer', creatorId: 'customer-1', orderReviewRequired: true,
    }, { generateId });
    submitOrder(store, { tenantId: 'tenant-a', orderId: order.id, actorId: 'customer-1', actorRole: 'customer', orderReviewRequired: true }, { generateId });
    assert.equal(order.status, 'PENDING_REVIEW');
    assert.throws(
      () => rejectOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF }, { generateId }),
      (error: unknown) => error instanceof CommerceError && error.code === 'not-permitted',
    );
    rejectOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...ADMIN, reason: 'Fully booked' }, { generateId });
    assert.equal(order.status, 'REJECTED');
  });

  it('cancels draft orders', () => {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'service', refId: 'svc-cut', quantity: 1 }],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    cancelOrder(store, { tenantId: 'tenant-a', orderId: order.id }, { generateId });
    assert.equal(order.status, 'CANCELLED');
  });
});

describe('voidSale (reversal)', () => {
  it('voids with RETURN for products and ADJUSTMENT for consumed components', () => {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [
        { kind: 'service', refId: 'svc-color', quantity: 1 },
        { kind: 'product', refId: 'prod-oil', quantity: 2 },
      ],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    submitOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF, orderReviewRequired: true }, { generateId });
    const { sale } = approveOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...ADMIN }, { generateId });

    const { reversals } = voidSale(store, { tenantId: 'tenant-a', saleId: sale.id, ...ADMIN, reason: 'Duplicate' }, { generateId });
    assert.equal(sale.status, 'VOIDED');
    assert.equal(sale.voidReason, 'Duplicate');
    // Stock fully restored: 8->10 oil, 5->6 dye/dev.
    assert.equal(store.products.find((p) => p.id === 'prod-oil')?.quantityOnHand, 10);
    assert.equal(store.products.find((p) => p.id === 'prod-dye')?.quantityOnHand, 6);
    assert.equal(store.products.find((p) => p.id === 'prod-dev')?.quantityOnHand, 6);
    assert.equal(reversals.length, 3);
    assert.ok(reversals.some((m) => m.movementType === 'RETURN' && m.quantity === 2 && m.referenceType === 'sale_void'));
    assert.ok(reversals.some((m) => m.movementType === 'ADJUSTMENT'));
    assert.throws(
      () => voidSale(store, { tenantId: 'tenant-a', saleId: sale.id, ...ADMIN }, { generateId }),
      (error: unknown) => error instanceof CommerceError && error.code === 'already-voided',
    );
  });
});

describe('tenant isolation (commerce)', () => {
  it("admin cannot operate another tenant's order", () => {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'service', refId: 'svc-cut', quantity: 1 }],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    assert.throws(
      () => submitOrder(store, { tenantId: 'tenant-b', orderId: order.id, ...ADMIN, orderReviewRequired: true }, { generateId }),
      (error: unknown) => error instanceof CommerceError && error.code === 'unknown-item',
    );
  });

  it('idempotency keys never collide across tenants', () => {
    const store = testStore();
    createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'service', refId: 'svc-cut', quantity: 1 }],
      idempotencyKey: 'shared-key-9', creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    assert.equal(findOrderByIdempotencyKey(store, 'tenant-b', 'shared-key-9'), null);
    assert.equal(parseOrderIdempotencyKey('  '), null);
  });
});

describe('concurrency', () => {
  it('two sellers racing for the final unit: exactly one succeeds', () => {
    const store = testStore();
    store.products.find((p) => p.id === 'prod-oil')!.quantityOnHand = 1;

    const first = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'product', refId: 'prod-oil', quantity: 1 }],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    const second = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'product', refId: 'prod-oil', quantity: 1 }],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    for (const created of [first, second]) {
      submitOrder(store, { tenantId: 'tenant-a', orderId: created.order.id, ...STAFF, orderReviewRequired: true }, { generateId });
    }

    approveOrder(store, { tenantId: 'tenant-a', orderId: first.order.id, ...ADMIN }, { generateId });
    assert.throws(
      () => approveOrder(store, { tenantId: 'tenant-a', orderId: second.order.id, ...ADMIN }, { generateId }),
      (error: unknown) => error instanceof CommerceError && error.code === 'insufficient-stock',
    );
    assert.equal(store.products.find((p) => p.id === 'prod-oil')?.quantityOnHand, 0);
    assert.equal(store.sales.length, 1);
    assert.ok((store.inventoryMovements ?? []).every((m) => m.referenceType === 'sale'));
  });

  it('concurrent approval of the same order yields exactly one sale', () => {
    const store = testStore();
    const { order } = createOrder(store, {
      tenantId: 'tenant-a', sellerId: 'staff-1', source: 'STAFF',
      lines: [{ kind: 'service', refId: 'svc-cut', quantity: 1 }],
      creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
    }, { generateId });
    submitOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...STAFF, orderReviewRequired: true }, { generateId });
    const outcomes = [0, 1].map(() =>
      approveOrder(store, { tenantId: 'tenant-a', orderId: order.id, ...ADMIN }, { generateId }),
    );
    assert.equal(store.sales.length, 1);
    assert.deepEqual(outcomes.map((o) => o.sale.id), [store.sales[0].id, store.sales[0].id]);
    assert.ok(outcomes.some((o) => o.duplicate));
  });
});
