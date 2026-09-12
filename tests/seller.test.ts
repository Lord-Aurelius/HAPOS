import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  SELLER_ALLOWED_OPERATIONS,
  SellerError,
  assertCredentialFresh,
  assertSellerOperationAllowed,
  assertValidSellerReference,
  buildSellerReference,
  generateSellerBearer,
  hashSellerBearer,
} from '../src/server/commerce/seller.ts';

function assertSellerCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof SellerError && error.code === code,
    `expected SellerError ${code}`,
  );
}

describe('seller credential primitives', () => {
  it('generates bearers, hashes and references independently of attendance', () => {
    const bearer = generateSellerBearer('d4'.repeat(32));
    assert.equal(bearer.length, 64);
    assert.equal(hashSellerBearer(bearer), hashSellerBearer(bearer));
    assert.notEqual(hashSellerBearer(bearer), bearer);
    const reference = buildSellerReference('abcdef1234567890');
    assert.equal(reference, 'sel-abcdef1234567890');
    assert.equal(buildSellerReference().length, 20);
  });

  it('validates references strictly', () => {
    assert.equal(assertValidSellerReference('sel-abcdef1234567890'), 'sel-abcdef1234567890');
    assertSellerCode(() => assertValidSellerReference('att-shop-123456'), 'invalid-reference');
    assertSellerCode(() => assertValidSellerReference('sel-short'), 'invalid-reference');
    assertSellerCode(() => assertValidSellerReference(''), 'invalid-reference');
    assertSellerCode(() => assertValidSellerReference(null), 'invalid-reference');
  });

  it('restricts QR contexts to transaction-intent operations', () => {
    assert.equal(assertSellerOperationAllowed('CREATE_ORDER'), 'CREATE_ORDER');
    assert.equal(assertSellerOperationAllowed('SUBMIT_ORDER'), 'SUBMIT_ORDER');
    assert.ok(SELLER_ALLOWED_OPERATIONS.has('CREATE_ORDER'));
    for (const forbidden of ['READ_HISTORY', 'ADJUST_INVENTORY', 'MANAGE_USERS', 'READ_ATTENDANCE', 'ADMIN']) {
      assertSellerCode(() => assertSellerOperationAllowed(forbidden), 'forbidden-operation');
    }
  });

  it('enforces bearer expiry when configured', () => {
    assert.doesNotThrow(() => assertCredentialFresh(null, '2026-06-01T00:00:00.000Z'));
    assert.doesNotThrow(() => assertCredentialFresh('2026-07-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'));
    assertSellerCode(() => assertCredentialFresh('2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'), 'credential-expired');
  });
});
