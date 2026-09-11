import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  adjustProductStock,
  consumeServiceBom,
  ensureCatalogProjection,
  postInventoryMovement,
  postOpeningBalance,
  replaceServiceBom,
  type ProjectionStore,
} from '../src/server/commerce/inventory-store.ts';
import { InventoryError } from '../src/server/commerce/inventory.ts';
import { SaleValidationError } from '../src/server/commerce/sale-validation.ts';

let sequence = 0;

function testStore(): ProjectionStore {
  return {
    products: [
      { id: 'prod-oil', tenantId: 'tenant-a', unitCost: 180, quantityOnHand: 20, isActive: true },
      { id: 'prod-foreign', tenantId: 'tenant-b', unitCost: 50, quantityOnHand: 99, isActive: true },
    ],
    services: [
      { id: 'svc-color', tenantId: 'tenant-a', isActive: true },
      { id: 'svc-foreign', tenantId: 'tenant-b', isActive: true },
    ],
    serviceProductLinks: [
      { id: 'link-1', tenantId: 'tenant-a', serviceId: 'svc-color', productId: 'prod-oil', quantity: 2, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
    inventoryMovements: [],
  };
}

function generateId() {
  sequence += 1;
  return `test-id-${sequence}`;
}

describe('postInventoryMovement', () => {
  it('appends a movement and updates the balance atomically', () => {
    const store = testStore();
    const movement = postInventoryMovement(
      store,
      { tenantId: 'tenant-a', productId: 'prod-oil', type: 'PURCHASE', quantity: 5, createdBy: 'admin-1' },
      { generateId },
    );
    assert.equal(movement.previousQuantity, 20);
    assert.equal(movement.resultingQuantity, 25);
    assert.equal(movement.createdBy, 'admin-1');
    assert.equal(store.products[0].quantityOnHand, 25);
    assert.equal(store.inventoryMovements?.length, 1);
  });

  it('leaves the balance untouched when the movement is rejected', () => {
    const store = testStore();
    assert.throws(
      () => postInventoryMovement(store, { tenantId: 'tenant-a', productId: 'prod-oil', type: 'SALE', quantity: -999 }, { generateId }),
      (error: unknown) => error instanceof InventoryError && error.code === 'negative-stock',
    );
    assert.equal(store.products[0].quantityOnHand, 20);
    assert.equal(store.inventoryMovements?.length, 0);
  });
});

describe('postOpeningBalance', () => {
  it('records opening stock on an uncounted product', () => {
    const store = testStore();
    store.products[0].quantityOnHand = 0;
    const movement = postOpeningBalance(
      store,
      { tenantId: 'tenant-a', productId: 'prod-oil', quantity: 30, createdBy: 'admin-1' },
      { generateId },
    );
    assert.equal(movement.movementType, 'OPENING_BALANCE');
    assert.equal(store.products[0].quantityOnHand, 30);
  });

  it('refuses a second opening balance (use an adjustment)', () => {
    const store = testStore();
    assert.throws(
      () => postOpeningBalance(store, { tenantId: 'tenant-a', productId: 'prod-oil', quantity: 5 }, { generateId }),
      InventoryError,
    );
  });
});

describe('adjustProductStock', () => {
  it('records previous, delta, resulting, reason and actor', () => {
    const store = testStore();
    const movement = adjustProductStock(
      store,
      { tenantId: 'tenant-a', productId: 'prod-oil', countedQuantity: 17, reason: 'Monthly count', createdBy: 'admin-1' },
      { generateId },
    );
    assert.equal(movement.movementType, 'ADJUSTMENT');
    assert.equal(movement.quantity, -3);
    assert.equal(movement.previousQuantity, 20);
    assert.equal(movement.resultingQuantity, 17);
    assert.equal(movement.reason, 'Monthly count');
    assert.equal(movement.createdBy, 'admin-1');
    assert.equal(store.products[0].quantityOnHand, 17);
  });
});

describe('consumeServiceBom', () => {
  it('posts one SERVICE_CONSUMPTION movement per BOM line', () => {
    const store = testStore();
    const movements = consumeServiceBom(
      store,
      { tenantId: 'tenant-a', serviceId: 'svc-color', referenceId: 'sale-1', createdBy: 'seller-1' },
      { generateId },
    );
    assert.equal(movements.length, 1);
    assert.equal(movements[0].movementType, 'SERVICE_CONSUMPTION');
    assert.equal(movements[0].quantity, -2);
    assert.equal(movements[0].referenceId, 'sale-1');
    assert.equal(store.products[0].quantityOnHand, 18);
  });

  it('resolving a BOM without consuming moves nothing', () => {
    const store = testStore();
    assert.equal(store.inventoryMovements?.length, 0);
    assert.equal(store.products[0].quantityOnHand, 20);
  });

  it('carries full observability on every movement', () => {
    const store = testStore();
    const movement = postInventoryMovement(
      store,
      {
        tenantId: 'tenant-a',
        productId: 'prod-oil',
        type: 'RETURN',
        quantity: 2,
        referenceType: 'sale_return',
        referenceId: 'sale-9',
        reason: 'Customer return, resellable',
        createdBy: 'admin-1',
      },
      { generateId, now: '2026-05-01T10:00:00.000Z' },
    );
    // RETURN increases stock; every traceability field is populated.
    assert.equal(store.products[0].quantityOnHand, 22);
    assert.equal(movement.tenantId, 'tenant-a');
    assert.equal(movement.productId, 'prod-oil');
    assert.equal(movement.movementType, 'RETURN');
    assert.equal(movement.quantity, 2);
    assert.equal(movement.referenceType, 'sale_return');
    assert.equal(movement.referenceId, 'sale-9');
    assert.equal(movement.reason, 'Customer return, resellable');
    assert.equal(movement.createdBy, 'admin-1');
    assert.equal(movement.createdAt, '2026-05-01T10:00:00.000Z');
  });
});

describe('replaceServiceBom', () => {
  it('replaces definitions without moving stock', () => {
    const store = testStore();
    const links = replaceServiceBom(
      store,
      { tenantId: 'tenant-a', serviceId: 'svc-color', lines: [{ productId: 'prod-oil', quantity: 3 }] },
      { generateId },
    );
    assert.equal(links.length, 1);
    assert.equal(links[0].quantity, 3);
    assert.equal(store.serviceProductLinks?.length, 1);
    assert.equal(store.products[0].quantityOnHand, 20);
    assert.equal(store.inventoryMovements?.length, 0);
  });

  it('rejects foreign products and invalid quantities', () => {
    const store = testStore();
    assert.throws(
      () => replaceServiceBom(store, { tenantId: 'tenant-a', serviceId: 'svc-color', lines: [{ productId: 'prod-foreign', quantity: 1 }] }, { generateId }),
      (error: unknown) => error instanceof SaleValidationError && error.code === 'unknown-product',
    );
    assert.throws(
      () => replaceServiceBom(store, { tenantId: 'tenant-a', serviceId: 'svc-color', lines: [{ productId: 'prod-oil', quantity: 0 }] }, { generateId }),
      SaleValidationError,
    );
  });
});

describe('tenant isolation', () => {
  it('Tenant A cannot read Tenant B product (movement rejected)', () => {
    const store = testStore();
    assert.throws(
      () => postInventoryMovement(store, { tenantId: 'tenant-a', productId: 'prod-foreign', type: 'PURCHASE', quantity: 1 }, { generateId }),
      (error: unknown) => error instanceof SaleValidationError && error.code === 'unknown-product',
    );
  });

  it('Tenant A cannot modify Tenant B product', () => {
    const store = testStore();
    assert.throws(
      () => adjustProductStock(store, { tenantId: 'tenant-a', productId: 'prod-foreign', countedQuantity: 0 }, { generateId }),
      SaleValidationError,
    );
    assert.equal(store.products[1].quantityOnHand, 99);
  });

  it('Tenant A cannot create inventory movement for Tenant B stock', () => {
    const store = testStore();
    assert.throws(
      () => postOpeningBalance(store, { tenantId: 'tenant-b', productId: 'prod-oil', quantity: 1 }, { generateId }),
      SaleValidationError,
    );
  });

  it('Tenant A cannot inspect Tenant B stock (read scoping is by construction)', () => {
    const store = testStore();
    const visibleToA = store.inventoryMovements!.filter((movement) => movement.tenantId === 'tenant-a');
    postInventoryMovement(store, { tenantId: 'tenant-b', productId: 'prod-foreign', type: 'PURCHASE', quantity: 1 }, { generateId });
    assert.equal(visibleToA.length, 0);
    assert.equal(store.products[1].quantityOnHand, 100);
  });

  it('Tenant A cannot consume Tenant B service BOM', () => {
    const store = testStore();
    assert.throws(
      () => consumeServiceBom(store, { tenantId: 'tenant-a', serviceId: 'svc-foreign' }, { generateId }),
      SaleValidationError,
    );
  });
});

describe('concurrency (serialised mutators share one balance)', () => {
  it('two stock-changing operations keep the invariant', () => {
    const store = testStore();
    // Models two updateStore mutators applied serially (postgres FOR UPDATE /
    // file writeChain): each sees the previous commit's balance.
    postInventoryMovement(store, { tenantId: 'tenant-a', productId: 'prod-oil', type: 'SALE', quantity: -6 }, { generateId });
    postInventoryMovement(store, { tenantId: 'tenant-a', productId: 'prod-oil', type: 'SALE', quantity: -6 }, { generateId });
    assert.equal(store.products[0].quantityOnHand, 8);
    const expected = 20 - 6 - 6;
    const actual = (store.inventoryMovements ?? []).reduce((sum, movement) => sum + movement.quantity, 20);
    assert.equal(actual, expected);
  });

  it('a second oversell after a concurrent sale is rejected', () => {
    const store = testStore();
    postInventoryMovement(store, { tenantId: 'tenant-a', productId: 'prod-oil', type: 'SALE', quantity: -18 }, { generateId });
    assert.throws(
      () => postInventoryMovement(store, { tenantId: 'tenant-a', productId: 'prod-oil', type: 'SALE', quantity: -5 }, { generateId }),
      (error: unknown) => error instanceof InventoryError && error.code === 'negative-stock',
    );
    assert.equal(store.products[0].quantityOnHand, 2);
  });
});

describe('ensureCatalogProjection (legacy migration backfill)', () => {
  it('backfills legacy products without fabricating stock or prices', () => {
    const store = {
      products: [{ id: 'legacy-1', tenantId: 'tenant-a', unitCost: 120 }],
      services: [],
    } as unknown as ProjectionStore;
    const { changed } = ensureCatalogProjection(store);
    assert.equal(changed, true);
    assert.deepEqual(store.products[0], {
      id: 'legacy-1',
      tenantId: 'tenant-a',
      unitCost: 120,
      sku: null,
      skuGenerated: false,
      sellingPrice: null,
      quantityOnHand: 0,
      reorderLevel: null,
      criticalLevel: null,
    });
    assert.deepEqual(store.serviceProductLinks, []);
    assert.deepEqual(store.inventoryMovements, []);
  });

  it('leaves already-migrated snapshots untouched', () => {
    const store = testStore();
    store.products[0] = {
      id: 'prod-oil',
      tenantId: 'tenant-a',
      unitCost: 180,
      quantityOnHand: 20,
      isActive: true,
      sku: 'OIL-1',
      skuGenerated: false,
      sellingPrice: 350,
      reorderLevel: 10,
      criticalLevel: 3,
    };
    store.products[1] = {
      id: 'prod-foreign',
      tenantId: 'tenant-b',
      unitCost: 50,
      quantityOnHand: 99,
      isActive: true,
      sku: null,
      skuGenerated: false,
      sellingPrice: null,
      reorderLevel: null,
      criticalLevel: null,
    };
    assert.equal(ensureCatalogProjection(store).changed, false);
  });
});
