import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  amendEngineSaleForCorrection,
  approveOrder,
  createOrder,
  submitOrder,
  type CommerceStore,
} from '../src/server/commerce/commerce-store.ts';
import { CommerceError } from '../src/server/commerce/orders.ts';

let sequence = 1000;
function generateId() {
  sequence += 1;
  return `amend-test-${sequence}`;
}

function coWrittenSale() {
  const store: CommerceStore = {
    products: [
      { id: 'prod-dye', tenantId: 'tenant-a', name: 'Hair Dye', sellingPrice: 1200, unitCost: 500, sku: 'DYE-1', quantityOnHand: 6, isActive: true },
      { id: 'prod-dev', tenantId: 'tenant-a', name: 'Developer', sellingPrice: 400, unitCost: 150, sku: 'DEV-1', quantityOnHand: 6, isActive: true },
      { id: 'prod-oil', tenantId: 'tenant-a', name: 'Hair Oil', sellingPrice: 800, unitCost: 300, sku: 'OIL-1', quantityOnHand: 10, isActive: true },
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
    serviceRecords: [],
    saleAmendments: [],
    orders: [],
    orderItems: [],
    sales: [],
    saleItems: [],
  };

  const created = createOrder(store, {
    tenantId: 'tenant-a', customerId: 'customer-1', sellerId: 'staff-1', source: 'STAFF',
    lines: [{ kind: 'service', refId: 'svc-color', quantity: 1 }],
    creatorRole: 'staff', creatorId: 'staff-1', orderReviewRequired: true,
  }, { generateId });
  submitOrder(store, { tenantId: 'tenant-a', orderId: created.order.id, actorId: 'staff-1', actorRole: 'staff', orderReviewRequired: true }, { generateId });
  const approved = approveOrder(store, { tenantId: 'tenant-a', orderId: created.order.id, actorId: 'admin-1', actorRole: 'shop_admin' }, { generateId });

  const legacyRecord = { id: 'legacy-1', tenantId: 'tenant-a', commerceSaleId: approved.sale.id };
  store.serviceRecords!.push(legacyRecord);
  return { store, saleId: approved.sale.id };
}

describe('amendEngineSaleForCorrection', () => {
  it('syncs totals and commission without moving stock (price-only)', () => {
    const { store } = coWrittenSale();
    const dyeBefore = store.products.find((p) => p.id === 'prod-dye')!.quantityOnHand;
    const movementsBefore = (store.inventoryMovements ?? []).length;

    const result = amendEngineSaleForCorrection(store, {
      tenantId: 'tenant-a',
      legacyRecordId: 'legacy-1',
      corrected: {
        price: 2800, serviceId: 'svc-color', serviceName: 'Colour',
        commissionType: 'percentage', commissionValue: 15, commissionAmount: 420,
      },
      actorId: 'admin-1',
      reason: 'Agreed loyalty discount',
    }, { generateId });

    assert.equal(result.amended, true);
    assert.equal(result.stockSynced, false);
    const sale = store.sales[0];
    assert.equal(sale.total, 2800);
    assert.equal(sale.subtotal, 2800);
    const item = store.saleItems[0];
    assert.equal(item.actualUnitPrice, 2800);
    assert.equal(item.lineTotal, 2800);
    assert.equal(item.catalogUnitPrice, 3000);
    assert.equal(item.commissionAmount, 420);
    assert.equal(store.products.find((p) => p.id === 'prod-dye')!.quantityOnHand, dyeBefore);
    assert.equal((store.inventoryMovements ?? []).length, movementsBefore);

    const amendments = store.saleAmendments ?? [];
    assert.equal(amendments.length, 1);
    assert.equal(amendments[0].previousTotal, 3000);
    assert.equal(amendments[0].newTotal, 2800);
    assert.equal(amendments[0].reason, 'Agreed loyalty discount');
    assert.ok(amendments[0].fieldChanges.some((c) => c.field === 'actualUnitPrice'));
  });

  it('syncs stock on service change (reverse old BOM, post new BOM)', () => {
    const { store } = coWrittenSale();
    // After approval: dye 5, dev 5.
    assert.equal(store.products.find((p) => p.id === 'prod-dye')!.quantityOnHand, 5);

    const result = amendEngineSaleForCorrection(store, {
      tenantId: 'tenant-a',
      legacyRecordId: 'legacy-1',
      corrected: {
        price: 250, serviceId: 'svc-cut', serviceName: 'Haircut',
        commissionType: 'percentage', commissionValue: 10, commissionAmount: 25,
      },
      actorId: 'admin-1',
      reason: 'Wrong service selected',
    }, { generateId });

    assert.equal(result.stockSynced, true);
    // Dye/dev restored to 6; cut consumes nothing.
    assert.equal(store.products.find((p) => p.id === 'prod-dye')!.quantityOnHand, 6);
    assert.equal(store.products.find((p) => p.id === 'prod-dev')!.quantityOnHand, 6);
    const types = (store.inventoryMovements ?? []).map((m) => m.movementType);
    assert.ok(types.filter((t) => t === 'ADJUSTMENT').length >= 2);
    assert.equal(store.sales[0].total, 250);
    const item = store.saleItems[0];
    assert.equal(item.serviceId, 'svc-cut');
    assert.deepEqual(item.itemSnapshot, { durationMinutes: 30, consumedProducts: [] });
  });

  it('blocks the whole correction on insufficient stock (legacy untouched)', () => {
    const { store } = coWrittenSale();
    // Drain dye so the colour BOM cannot be re-posted... first move to cut,
    // then attempt to move back to colour with empty dye stock.
    amendEngineSaleForCorrection(store, {
      tenantId: 'tenant-a', legacyRecordId: 'legacy-1',
      corrected: { price: 250, serviceId: 'svc-cut', serviceName: 'Haircut', commissionType: 'percentage', commissionValue: 10, commissionAmount: 25 },
      actorId: 'admin-1', reason: 'Wrong service',
    }, { generateId });
    store.products.find((p) => p.id === 'prod-dye')!.quantityOnHand = 0;

    assert.throws(
      () => amendEngineSaleForCorrection(store, {
        tenantId: 'tenant-a', legacyRecordId: 'legacy-1',
        corrected: { price: 3000, serviceId: 'svc-color', serviceName: 'Colour', commissionType: 'percentage', commissionValue: 15, commissionAmount: 450 },
        actorId: 'admin-1', reason: 'Actually it was colour',
      }, { generateId }),
      (error: unknown) => error instanceof CommerceError && error.code === 'insufficient-stock',
    );
    // Sale still reflects the cut restatement; no partial re-posting.
    assert.equal(store.sales[0].total, 250);
    assert.equal(store.products.find((p) => p.id === 'prod-dye')!.quantityOnHand, 0);
  });

  it('no-ops legacy-only rows and requires a reason', () => {
    const { store } = coWrittenSale();
    store.serviceRecords!.push({ id: 'legacy-custom', tenantId: 'tenant-a', commerceSaleId: null });
    const result = amendEngineSaleForCorrection(store, {
      tenantId: 'tenant-a', legacyRecordId: 'legacy-custom',
      corrected: { price: 1000, serviceId: null, serviceName: 'Custom', commissionType: 'percentage', commissionValue: 10, commissionAmount: 100 },
      actorId: 'admin-1', reason: 'Custom tweak',
    }, { generateId });
    assert.equal(result.amended, false);

    assert.throws(
      () => amendEngineSaleForCorrection(store, {
        tenantId: 'tenant-a', legacyRecordId: 'legacy-1',
        corrected: { price: 2800, serviceId: 'svc-color', serviceName: 'Colour', commissionType: 'percentage', commissionValue: 15, commissionAmount: 420 },
        actorId: 'admin-1', reason: '   ',
      }, { generateId }),
      (error: unknown) => error instanceof CommerceError && error.code === 'amendment-reason-required',
    );
  });
});
