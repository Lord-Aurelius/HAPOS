import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  assertSkuUnique,
  buildCatalogReadModel,
  generateSku,
  normalizeSku,
  parseThresholds,
  validateProductInput,
  validateServiceInput,
} from '../src/server/commerce/catalog.ts';
import { SaleValidationError } from '../src/server/commerce/sale-validation.ts';

function assertCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof SaleValidationError && error.code === code,
    `expected SaleValidationError ${code}`,
  );
}

describe('validateProductInput', () => {
  it('accepts a full merchant product definition', () => {
    assert.deepEqual(
      validateProductInput({
        name: 'Beard Oil',
        description: 'Conditioning oil',
        sku: 'oil-001',
        unitCost: '180',
        sellingPrice: '350',
        reorderLevel: '10',
        criticalLevel: '3',
      }),
      {
        name: 'Beard Oil',
        description: 'Conditioning oil',
        sku: 'OIL-001',
        unitCost: 180,
        sellingPrice: 350,
        reorderLevel: 10,
        criticalLevel: 3,
        needsPricing: false,
      },
    );
  });

  it('flags missing selling price as needs_pricing instead of inventing one', () => {
    const result = validateProductInput({ name: 'Pomade', unitCost: 120, sellingPrice: '' });
    assert.equal(result.sellingPrice, null);
    assert.equal(result.needsPricing, true);
  });

  it('retains unit_cost as the cost basis and validates it strictly', () => {
    assertCode(() => validateProductInput({ name: 'X', unitCost: 'abc' }), 'invalid-price');
    assertCode(() => validateProductInput({ name: 'X', unitCost: '-5' }), 'invalid-price');
    assertCode(() => validateProductInput({ name: '', unitCost: 10 }), 'missing-name');
  });

  it('rejects critical levels above reorder levels', () => {
    assertCode(
      () => validateProductInput({ name: 'X', unitCost: 10, reorderLevel: '5', criticalLevel: '8' }),
      'invalid-threshold',
    );
  });
});

describe('normalizeSku / generateSku / assertSkuUnique', () => {
  it('normalises SKUs and accepts empty as uncatalogued', () => {
    assert.equal(normalizeSku('  abc-123 '), 'ABC-123');
    assert.equal(normalizeSku(''), null);
    assert.equal(normalizeSku(null), null);
    assertCode(() => normalizeSku('has spaces!'), 'invalid-sku');
  });

  it('generates flagged placeholder SKUs', () => {
    const generated = generateSku('a1b2c3d4e5');
    assert.equal(generated.sku, 'SKU-A1B2C3D4');
    assert.equal(generated.skuGenerated, true);
  });

  it('enforces per-tenant uniqueness, case-insensitively', () => {
    const products = [{ id: 'p1', tenantId: 't1', sku: 'ABC-1' }];
    assertCode(() => assertSkuUnique(products, 't1', 'abc-1'), 'duplicate-sku');
    // Other tenants are unaffected; self-edit is unaffected; null never clashes.
    assert.doesNotThrow(() => assertSkuUnique(products, 't2', 'abc-1'));
    assert.doesNotThrow(() => assertSkuUnique(products, 't1', 'abc-1', 'p1'));
    assert.doesNotThrow(() => assertSkuUnique(products, 't1', null));
  });
});

describe('parseThresholds', () => {
  it('resolves empty thresholds to null (alerts silent until configured)', () => {
    assert.deepEqual(parseThresholds({}), { reorderLevel: null, criticalLevel: null });
  });
});

describe('validateServiceInput', () => {
  it('accepts a merchant service definition', () => {
    assert.deepEqual(
      validateServiceInput({ name: 'Haircut', price: '800', durationMinutes: '30', commissionType: 'fixed', commissionValue: '200' }),
      { name: 'Haircut', description: '', price: 800, durationMinutes: 30, commissionType: 'fixed', commissionValue: 200 },
    );
  });

  it('keeps commission optional and duration unset when blank', () => {
    const result = validateServiceInput({ name: 'Consult', price: 0 });
    assert.equal(result.durationMinutes, undefined);
    assert.equal(result.commissionValue, 0);
  });
});

describe('buildCatalogReadModel', () => {
  const products = [
    { id: 'p1', tenantId: 't1', name: 'Oil', sellingPrice: 350, quantityOnHand: 12, sku: 'OIL-1', isActive: true },
    { id: 'p2', tenantId: 't1', name: 'Legacy', sellingPrice: null, quantityOnHand: 0, sku: null, isActive: true },
    { id: 'p3', tenantId: 't1', name: 'Retired', sellingPrice: 100, quantityOnHand: 5, sku: null, isActive: false },
    { id: 'px', tenantId: 't2', name: 'Foreign', sellingPrice: 10, quantityOnHand: 9, sku: null, isActive: true },
  ];
  const services = [
    { id: 's1', tenantId: 't1', name: 'Cut', price: 800, isActive: true },
    { id: 's2', tenantId: 't1', name: 'Paused', price: 500, isActive: false },
  ];

  it('returns a uniform shape for products and services', () => {
    const items = buildCatalogReadModel({ tenantId: 't1', products, services });
    const oil = items.find((item) => item.id === 'p1')!;
    assert.equal(oil.type, 'product');
    assert.equal(oil.catalogPrice, 350);
    assert.equal(oil.quantityOnHand, 12);
    const cut = items.find((item) => item.id === 's1')!;
    assert.equal(cut.type, 'service');
    assert.equal(cut.catalogPrice, 800);
    assert.equal(cut.quantityOnHand, null);
  });

  it('exposes unpriced products with null catalog price (needs_pricing)', () => {
    const items = buildCatalogReadModel({ tenantId: 't1', products, services });
    assert.equal(items.find((item) => item.id === 'p2')?.catalogPrice, null);
  });

  it('excludes inactive items and other tenants by default', () => {
    const ids = buildCatalogReadModel({ tenantId: 't1', products, services }).map((item) => item.id);
    assert.ok(!ids.includes('p3') && !ids.includes('s2') && !ids.includes('px'));
  });
});
