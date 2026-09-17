import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  projectCompletedSaleToLegacyRecord,
  type ProjectionStore,
} from '../src/server/commerce/legacy-projection.ts';

let sequence = 0;
function generateId() {
  sequence += 1;
  return `projection-test-${sequence}`;
}

function projectionStore(): ProjectionStore {
  return {
    serviceRecords: [],
    users: [
      { id: 'staff-1', tenantId: 'tenant-a', fullName: 'Amina Seller', commissionType: 'percentage', commissionValue: 10 },
      { id: 'admin-1', tenantId: 'tenant-a', fullName: 'Otis Admin', commissionType: 'fixed', commissionValue: 50 },
    ],
    products: [
      { id: 'prod-oil', tenantId: 'tenant-a', unitCost: 300 },
      { id: 'prod-dye', tenantId: 'tenant-a', unitCost: 500 },
    ],
    services: [
      { id: 'svc-cut', tenantId: 'tenant-a', commissionType: 'percentage', commissionValue: 15 },
    ],
  };
}

describe('projectCompletedSaleToLegacyRecord', () => {
  it('projects a product QR sale with money, link, stock narrative and staff commission', () => {
    const store = projectionStore();
    const record = projectCompletedSaleToLegacyRecord(store, {
      sale: { id: 'sale-1', tenantId: 'tenant-a', customerId: null, sellerId: 'staff-1', total: 1400, completedAt: '2026-09-01T10:00:00.000Z' },
      orderNotes: null,
      items: [{ itemType: 'PRODUCT', productId: 'prod-oil', serviceId: null, quantity: 2, itemName: 'Hair Oil' }],
      actorId: 'admin-1',
      generateId,
      now: '2026-09-01T10:00:00.000Z',
    });
    assert.ok(record);
    assert.equal(record.tenantId, 'tenant-a');
    assert.equal(record.commerceSaleId, 'sale-1');
    assert.equal(record.price, 1400);
    assert.equal(record.staffId, 'staff-1');
    assert.equal(record.performedAt, '2026-09-01T10:00:00.000Z');
    assert.equal(record.recordedBy, 'admin-1');
    // Walk-in QR sales carry no customer: empty id, never a fabricated one.
    assert.equal(record.customerId, '');
    // Staff terms override defaults: 10% of 1400.
    assert.equal(record.commissionType, 'percentage');
    assert.equal(record.commissionValue, 10);
    assert.equal(record.commissionAmount, 140);
    // Stock narrative mirrors the engine movement (product × quantity @ cost).
    assert.deepEqual(record.productUsages, [{ productId: 'prod-oil', quantity: 2, unitCost: 300 }]);
    assert.equal(store.serviceRecords.length, 1);
  });

  it('is idempotent by commerceSaleId link (re-approval never duplicates statistics)', () => {
    const store = projectionStore();
    const input = {
      sale: { id: 'sale-1', tenantId: 'tenant-a', customerId: null, sellerId: 'staff-1', total: 1400, completedAt: '2026-09-01T10:00:00.000Z' },
      orderNotes: null,
      items: [{ itemType: 'PRODUCT' as const, productId: 'prod-oil', serviceId: null, quantity: 2, itemName: 'Hair Oil' }],
      actorId: 'admin-1',
      generateId,
      now: '2026-09-01T10:00:00.000Z',
    };
    assert.ok(projectCompletedSaleToLegacyRecord(store, input));
    assert.equal(projectCompletedSaleToLegacyRecord(store, input), null);
    assert.equal(store.serviceRecords.length, 1);
  });

  it('reuses the engine BOM snapshot for service sales', () => {
    const store = projectionStore();
    const record = projectCompletedSaleToLegacyRecord(store, {
      sale: { id: 'sale-2', tenantId: 'tenant-a', customerId: 'customer-9', sellerId: 'staff-1', total: 3000, completedAt: '2026-09-02T10:00:00.000Z' },
      orderNotes: 'QR note',
      items: [{
        itemType: 'SERVICE', productId: null, serviceId: 'svc-cut', quantity: 1, itemName: 'Haircut',
        itemSnapshot: { consumedProducts: [{ productId: 'prod-dye', quantity: 1 }] },
      }],
      actorId: 'admin-1',
      generateId,
      now: '2026-09-02T10:00:00.000Z',
    });
    assert.ok(record);
    assert.equal(record.serviceId, 'svc-cut');
    assert.equal(record.isCustomService, false);
    assert.equal(record.customerId, 'customer-9');
    assert.equal(record.description, 'QR note');
    assert.deepEqual(record.productUsages, [{ productId: 'prod-dye', quantity: 1, unitCost: 500 }]);
  });

  it('degrades without throwing on unknown sellers, products and services', () => {
    const store = projectionStore();
    const record = projectCompletedSaleToLegacyRecord(store, {
      sale: { id: 'sale-3', tenantId: 'tenant-a', customerId: null, sellerId: 'ghost', total: 500, completedAt: null },
      orderNotes: null,
      items: [
        { itemType: 'PRODUCT', productId: 'prod-gone', serviceId: null, quantity: 1, itemName: 'Deleted Oil' },
        { itemType: 'SERVICE', productId: null, serviceId: 'svc-gone', quantity: 1, itemName: 'Deleted Cut' },
      ],
      actorId: 'admin-1',
      generateId,
      now: '2026-09-03T10:00:00.000Z',
    });
    assert.ok(record);
    // Money and the sale link are always preserved.
    assert.equal(record.price, 500);
    assert.equal(record.commerceSaleId, 'sale-3');
    assert.equal(record.performedAt, '2026-09-03T10:00:00.000Z');
    assert.equal(record.staffId, 'ghost');
    assert.equal(record.serviceId, null);
    assert.equal(record.isCustomService, true);
    assert.equal(record.commissionAmount, 0);
    assert.deepEqual(record.productUsages, [{ productId: 'prod-gone', quantity: 1, unitCost: 0 }]);
  });
});
