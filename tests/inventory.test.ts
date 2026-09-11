import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  InventoryError,
  applyMovement,
  getStockStatus,
  planAdjustment,
  resolveServiceConsumption,
  verifyStockInvariant,
} from '../src/server/commerce/inventory.ts';

function assertInventoryCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof InventoryError && error.code === code,
    `expected InventoryError ${code}`,
  );
}

describe('applyMovement', () => {
  it('applies stock-in and stock-out deltas', () => {
    assert.deepEqual(applyMovement(10, { type: 'PURCHASE', quantity: 5 }), {
      previousQuantity: 10,
      resultingQuantity: 15,
    });
    assert.deepEqual(applyMovement(10, { type: 'SALE', quantity: -4 }), {
      previousQuantity: 10,
      resultingQuantity: 6,
    });
  });

  it('rejects zero and fractional quantities', () => {
    assertInventoryCode(() => applyMovement(10, { type: 'PURCHASE', quantity: 0 }), 'zero-quantity');
    assertInventoryCode(() => applyMovement(10, { type: 'SALE', quantity: -1.5 }), 'zero-quantity');
  });

  it('enforces sign semantics per movement type', () => {
    assertInventoryCode(() => applyMovement(10, { type: 'SALE', quantity: 3 }), 'invalid-sign');
    assertInventoryCode(() => applyMovement(10, { type: 'PURCHASE', quantity: -3 }), 'invalid-sign');
    assertInventoryCode(() => applyMovement(0, { type: 'OPENING_BALANCE', quantity: -5 }), 'invalid-sign');
    // Signed types accept either direction.
    assert.deepEqual(applyMovement(10, { type: 'ADJUSTMENT', quantity: 2 }).resultingQuantity, 12);
    assert.deepEqual(applyMovement(10, { type: 'ADJUSTMENT', quantity: -2 }).resultingQuantity, 8);
  });

  it('rejects negative stock by default, allows explicit opt-in', () => {
    assertInventoryCode(() => applyMovement(2, { type: 'SALE', quantity: -5 }), 'negative-stock');
    assert.deepEqual(applyMovement(2, { type: 'SALE', quantity: -5 }, { allowNegative: true }).resultingQuantity, -3);
  });
});

describe('planAdjustment', () => {
  it('derives the delta from the physical count', () => {
    assert.deepEqual(planAdjustment(10, 7), { quantity: -3, previousQuantity: 10, resultingQuantity: 7 });
    assert.deepEqual(planAdjustment(10, 14), { quantity: 4, previousQuantity: 10, resultingQuantity: 14 });
  });

  it('rejects no-change and invalid counts', () => {
    assertInventoryCode(() => planAdjustment(10, 10), 'no-change');
    assertInventoryCode(() => planAdjustment(10, -1), 'negative-stock');
    assertInventoryCode(() => planAdjustment(10, 2.5), 'negative-stock');
  });
});

describe('verifyStockInvariant', () => {
  it('holds when balance equals opening plus movements', () => {
    const check = verifyStockInvariant({
      openingQuantity: 20,
      movements: [{ quantity: 10 }, { quantity: -4 }, { quantity: -1 }],
      quantityOnHand: 25,
    });
    assert.equal(check.valid, true);
    assert.equal(check.expected, 25);
  });

  it('detects drift', () => {
    const check = verifyStockInvariant({
      openingQuantity: 20,
      movements: [{ quantity: 10 }],
      quantityOnHand: 999,
    });
    assert.equal(check.valid, false);
    assert.equal(check.expected, 30);
  });
});

describe('getStockStatus (boundary semantics)', () => {
  const thresholds = { reorderLevel: 10, criticalLevel: 3 };

  it('classifies normal, low, critical and out-of-stock', () => {
    assert.equal(getStockStatus({ quantityOnHand: 50, ...thresholds }), 'in_stock');
    assert.equal(getStockStatus({ quantityOnHand: 7, ...thresholds }), 'low');
    assert.equal(getStockStatus({ quantityOnHand: 2, ...thresholds }), 'critical');
    assert.equal(getStockStatus({ quantityOnHand: 0, ...thresholds }), 'out_of_stock');
  });

  it('treats exact boundary values as the worse state', () => {
    assert.equal(getStockStatus({ quantityOnHand: 10, ...thresholds }), 'low');
    assert.equal(getStockStatus({ quantityOnHand: 3, ...thresholds }), 'critical');
  });

  it('handles missing thresholds (silent until configured)', () => {
    assert.equal(getStockStatus({ quantityOnHand: 50 }), 'in_stock');
    assert.equal(getStockStatus({ quantityOnHand: 0 }), 'out_of_stock');
    assert.equal(getStockStatus({ quantityOnHand: 2, reorderLevel: 10 }), 'low');
  });

  it('gives out-of-stock precedence over every threshold', () => {
    assert.equal(
      getStockStatus({ quantityOnHand: 0, reorderLevel: 10, criticalLevel: 3 }),
      'out_of_stock',
    );
  });
});

describe('resolveServiceConsumption (BOM is a definition, not a movement)', () => {
  const links = [
    { serviceId: 'svc-color', tenantId: 't1', productId: 'dye', quantity: 1 },
    { serviceId: 'svc-color', tenantId: 't1', productId: 'developer', quantity: 1 },
    { serviceId: 'svc-other', tenantId: 't1', productId: 'oil', quantity: 2 },
    { serviceId: 'svc-color', tenantId: 't2', productId: 'foreign', quantity: 9 },
  ];

  it('resolves consumption lines scaled by completion count', () => {
    assert.deepEqual(resolveServiceConsumption(links, 't1', 'svc-color'), [
      { productId: 'dye', quantity: 1 },
      { productId: 'developer', quantity: 1 },
    ]);
    assert.deepEqual(resolveServiceConsumption(links, 't1', 'svc-color', 3), [
      { productId: 'dye', quantity: 3 },
      { productId: 'developer', quantity: 3 },
    ]);
  });

  it('scopes to tenant and service, empty when undefined', () => {
    assert.deepEqual(resolveServiceConsumption(links, 't1', 'svc-missing'), []);
    assertInventoryCode(() => resolveServiceConsumption(links, 't1', 'svc-color', 0), 'zero-quantity');
  });
});
