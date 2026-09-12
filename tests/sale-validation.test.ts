import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SaleValidationError,
  parseExpenseDateInput,
  parseKenyanPhoneInput,
  parseMoneyInput,
  parseOptionalMoneyInput,
  parseProductQuantityInput,
  requireEntityId,
  resolveProductUsage,
} from '../src/server/commerce/sale-validation.ts';import { makeProduct } from './fixtures.ts';

function assertThrowsCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof SaleValidationError && error.code === code,
    `expected SaleValidationError with code ${code}`,
  );
}

describe('parseMoneyInput', () => {
  it('accepts valid amounts', () => {
    assert.equal(parseMoneyInput('1000', 'price'), 1000);
    assert.equal(parseMoneyInput(250.5, 'unitCost'), 250.5);
    assert.equal(parseMoneyInput('0', 'commissionValue'), 0);
  });

  it('rejects NaN-producing input instead of persisting NaN', () => {
    assertThrowsCode(() => parseMoneyInput(undefined, 'price'), 'invalid-price');
    assertThrowsCode(() => parseMoneyInput('', 'price'), 'invalid-price');
    assertThrowsCode(() => parseMoneyInput('abc', 'price'), 'invalid-price');
    assertThrowsCode(() => parseMoneyInput(Number(undefined), 'price'), 'invalid-price');
    assertThrowsCode(() => parseMoneyInput(Number.NaN, 'price'), 'invalid-price');
    assertThrowsCode(() => parseMoneyInput('Infinity', 'price'), 'invalid-price');
  });

  it('rejects negative amounts', () => {
    assertThrowsCode(() => parseMoneyInput('-5', 'amount', 'invalid-amount'), 'invalid-amount');
  });

  it('supports custom codes per write path', () => {
    assertThrowsCode(() => parseMoneyInput('nope', 'amount', 'invalid-amount'), 'invalid-amount');
  });
});

describe('parseOptionalMoneyInput', () => {
  it('resolves empty input to null', () => {
    assert.equal(parseOptionalMoneyInput('', 'price'), null);
    assert.equal(parseOptionalMoneyInput(null, 'price'), null);
    assert.equal(parseOptionalMoneyInput(undefined, 'price'), null);
  });

  it('still rejects malformed input', () => {
    assertThrowsCode(() => parseOptionalMoneyInput('abc', 'price'), 'invalid-price');
  });
});

describe('parseProductQuantityInput', () => {
  it('resolves empty input to 0 (no product entered)', () => {
    assert.equal(parseProductQuantityInput(''), 0);
    assert.equal(parseProductQuantityInput(null), 0);
    assert.equal(parseProductQuantityInput(undefined), 0);
  });

  it('accepts whole-number quantities', () => {
    assert.equal(parseProductQuantityInput('2'), 2);
    assert.equal(parseProductQuantityInput(0), 0);
  });

  it('rejects negative, fractional and non-numeric quantities', () => {
    assertThrowsCode(() => parseProductQuantityInput('-1'), 'invalid-quantity');
    assertThrowsCode(() => parseProductQuantityInput('2.5'), 'invalid-quantity');
    assertThrowsCode(() => parseProductQuantityInput('many'), 'invalid-quantity');
  });
});

describe('requireEntityId', () => {
  it('accepts non-empty ids and rejects blanks', () => {
    assert.equal(requireEntityId('service-1', 'serviceId'), 'service-1');
    assertThrowsCode(() => requireEntityId('', 'serviceId'), 'missing-id');
    assertThrowsCode(() => requireEntityId('   ', 'staffId'), 'missing-id');
    assertThrowsCode(() => requireEntityId(undefined, 'customerId'), 'missing-id');
  });
});

describe('resolveProductUsage', () => {
  const tenantId = 'tenant-test-shop';
  const products = [makeProduct()];

  it('resolves [] when no product is selected (form default qty=1 + productId="")', () => {
    assert.deepEqual(resolveProductUsage(products, tenantId, '', 1), []);
    assert.deepEqual(resolveProductUsage(products, tenantId, null, 1), []);
    assert.deepEqual(resolveProductUsage(products, tenantId, 'product-test-1', 0), []);
  });

  it('resolves the usage line with the catalog unit-cost snapshot', () => {
    assert.deepEqual(resolveProductUsage(products, tenantId, 'product-test-1', 2), [
      { productId: 'product-test-1', quantity: 2, unitCost: 250 },
    ]);
  });

  it('throws unknown-product instead of silently dropping the line', () => {
    assertThrowsCode(
      () => resolveProductUsage(products, tenantId, 'product-does-not-exist', 1),
      'unknown-product',
    );
  });

  it('enforces tenant scoping on product lookup', () => {
    const otherTenantProduct = makeProduct({ id: 'product-other', tenantId: 'tenant-other' });
    assertThrowsCode(() => resolveProductUsage([otherTenantProduct], tenantId, 'product-other', 1), 'unknown-product');
  });
});

describe('parseExpenseDateInput', () => {
  it('accepts ISO calendar days', () => {
    assert.equal(parseExpenseDateInput('2026-04-04'), '2026-04-04');
  });

  it('rejects free-text and malformed dates', () => {
    assertThrowsCode(() => parseExpenseDateInput(''), 'invalid-date');
    assertThrowsCode(() => parseExpenseDateInput('04/04/2026'), 'invalid-date');
    assertThrowsCode(() => parseExpenseDateInput('2026-13-40'), 'invalid-date');
    assertThrowsCode(() => parseExpenseDateInput('yesterday'), 'invalid-date');
  });
});

describe('parseKenyanPhoneInput (M-Pesa boundary)', () => {
  it('normalizes local, country-code and E.164 forms to +254', () => {
    assert.equal(parseKenyanPhoneInput('0712345678'), '+254712345678');
    assert.equal(parseKenyanPhoneInput('254712345678'), '+254712345678');
    assert.equal(parseKenyanPhoneInput('+254712345678'), '+254712345678');
    assert.equal(parseKenyanPhoneInput(' 0712 345 678 '), '+254712345678');
    assert.equal(parseKenyanPhoneInput('0112345678'), '+254112345678');
  });

  it('rejects malformed numbers without persisting anything', () => {
    assertThrowsCode(() => parseKenyanPhoneInput(''), 'invalid-phone');
    assertThrowsCode(() => parseKenyanPhoneInput('12345'), 'invalid-phone');
    assertThrowsCode(() => parseKenyanPhoneInput('07123'), 'invalid-phone');
    assertThrowsCode(() => parseKenyanPhoneInput('+15551234567'), 'invalid-phone');
    assertThrowsCode(() => parseKenyanPhoneInput('abcdefghij'), 'invalid-phone');
  });
});
