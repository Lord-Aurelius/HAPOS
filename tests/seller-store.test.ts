import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SellerError } from '../src/server/commerce/seller.ts';
import {
  issueSellerCredential,
  revokeSellerCredential,
  rotateSellerCredential,
  touchSellerCredentialUsed,
  verifySellerCredential,
  type SellerCredentialStore,
} from '../src/server/commerce/seller-store.ts';

let sequence = 0;
function generateId() {
  sequence += 1;
  return `seller-op-${sequence}`;
}

const BEARER_HEX = 'e5'.repeat(32);

function testStore(): SellerCredentialStore {
  return {
    users: [
      { id: 'seller-1', tenantId: 'tenant-a', role: 'staff', isActive: true },
      { id: 'seller-idle', tenantId: 'tenant-a', role: 'staff', isActive: false },
      { id: 'seller-foreign', tenantId: 'tenant-b', role: 'staff', isActive: true },
      { id: 'super-1', tenantId: null, role: 'super_admin', isActive: true },
    ],
    sellerCredentials: [],
  };
}

function assertSellerCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof SellerError && error.code === code,
    `expected SellerError ${code}`,
  );
}

describe('issueSellerCredential', () => {
  it('issues a bearer + hash-only row for an active seller', () => {
    const store = testStore();
    const { credential, bearer } = issueSellerCredential(
      store,
      { tenantId: 'tenant-a', sellerId: 'seller-1', createdBy: 'admin-1' },
      { generateId, bearerHex: BEARER_HEX },
    );
    assert.equal(bearer.length, 64);
    assert.equal(credential.status, 'ACTIVE');
    assert.ok(credential.tokenHash && credential.tokenHash !== bearer);
    assert.ok(credential.publicReference.startsWith('sel-'));
  });

  it('rejects unknown, inactive, foreign and super-admin sellers', () => {
    const store = testStore();
    assertSellerCode(
      () => issueSellerCredential(store, { tenantId: 'tenant-a', sellerId: 'nope' }, { generateId }),
      'unknown-seller',
    );
    assertSellerCode(
      () => issueSellerCredential(store, { tenantId: 'tenant-a', sellerId: 'seller-idle' }, { generateId }),
      'inactive-seller',
    );
    assertSellerCode(
      () => issueSellerCredential(store, { tenantId: 'tenant-a', sellerId: 'seller-foreign' }, { generateId }),
      'unknown-seller',
    );
    assertSellerCode(
      () => issueSellerCredential(store, { tenantId: 'tenant-a', sellerId: 'super-1' }, { generateId }),
      'unknown-seller',
    );
  });

  it('refuses a second active credential (rotate instead)', () => {
    const store = testStore();
    issueSellerCredential(store, { tenantId: 'tenant-a', sellerId: 'seller-1' }, { generateId });
    assertSellerCode(
      () => issueSellerCredential(store, { tenantId: 'tenant-a', sellerId: 'seller-1' }, { generateId }),
      'credential-active',
    );
  });
});

describe('rotateSellerCredential', () => {
  it('revokes the old bearer and issues a linked new one', () => {
    const store = testStore();
    const first = issueSellerCredential(
      store, { tenantId: 'tenant-a', sellerId: 'seller-1' }, { generateId, bearerHex: BEARER_HEX },
    );
    const second = rotateSellerCredential(
      store, { tenantId: 'tenant-a', sellerId: 'seller-1' }, { generateId, bearerHex: 'f6'.repeat(32) },
    );
    assert.equal(first.credential.status, 'REVOKED');
    assert.ok(first.credential.revokedAt);
    assert.equal(second.credential.status, 'ACTIVE');
    assert.equal(second.credential.rotatedFromId, first.credential.id);
    assert.notEqual(second.bearer, first.bearer);

    // Old reference fails as revoked (row status), never as a usable credential.
    assertSellerCode(
      () => verifySellerCredential(store, { tenantId: 'tenant-a', reference: first.credential.publicReference, bearer: first.bearer }, {}),
      'credential-revoked',
    );
    const context = verifySellerCredential(
      store, { tenantId: 'tenant-a', reference: second.credential.publicReference, bearer: second.bearer }, {},
    );
    assert.equal(context.sellerId, 'seller-1');
    assert.equal(context.credentialId, second.credential.id);
  });
});

describe('revokeSellerCredential', () => {
  it('revokes immediately; history rows stay intact', () => {
    const store = testStore();
    const { credential, bearer } = issueSellerCredential(
      store, { tenantId: 'tenant-a', sellerId: 'seller-1' }, { generateId, bearerHex: BEARER_HEX },
    );
    revokeSellerCredential(store, { tenantId: 'tenant-a', sellerId: 'seller-1' }, { generateId });
    assert.equal(credential.status, 'REVOKED');
    assertSellerCode(
      () => verifySellerCredential(store, { tenantId: 'tenant-a', reference: credential.publicReference, bearer }, {}),
      'credential-revoked',
    );
    // Revoking twice reports no active credential (idempotent-safe surface).
    assertSellerCode(
      () => revokeSellerCredential(store, { tenantId: 'tenant-a', sellerId: 'seller-1' }, { generateId }),
      'invalid-reference',
    );
  });
});

describe('verifySellerCredential', () => {
  it('rejects malformed, foreign-tenant and wrong bearers without oracles', () => {
    const store = testStore();
    const { credential, bearer } = issueSellerCredential(
      store, { tenantId: 'tenant-a', sellerId: 'seller-1' }, { generateId, bearerHex: BEARER_HEX },
    );
    assertSellerCode(
      () => verifySellerCredential(store, { tenantId: 'tenant-a', reference: 'bad!!', bearer }, {}),
      'invalid-reference',
    );
    assertSellerCode(
      () => verifySellerCredential(store, { tenantId: 'tenant-b', reference: credential.publicReference, bearer }, {}),
      'invalid-reference',
    );
    assertSellerCode(
      () => verifySellerCredential(store, { tenantId: 'tenant-a', reference: credential.publicReference, bearer: '0'.repeat(64) }, {}),
      'invalid-bearer',
    );
    assertSellerCode(
      () => verifySellerCredential(store, { tenantId: 'tenant-a', reference: credential.publicReference, bearer: '' }, {}),
      'invalid-bearer',
    );
  });

  it('rejects expired credentials and deactivated sellers', () => {
    const store = testStore();
    const { credential, bearer } = issueSellerCredential(
      store, { tenantId: 'tenant-a', sellerId: 'seller-1', expiresAt: '2026-01-01T00:00:00.000Z' },
      { generateId, bearerHex: BEARER_HEX },
    );
    assertSellerCode(
      () => verifySellerCredential(store, { tenantId: 'tenant-a', reference: credential.publicReference, bearer }, { now: '2026-06-01T00:00:00.000Z' }),
      'credential-expired',
    );

    const fresh = testStore();
    const issued = issueSellerCredential(
      fresh, { tenantId: 'tenant-a', sellerId: 'seller-1' }, { generateId, bearerHex: BEARER_HEX },
    );
    fresh.users.find((u) => u.id === 'seller-1')!.isActive = false;
    assertSellerCode(
      () => verifySellerCredential(fresh, { tenantId: 'tenant-a', reference: issued.credential.publicReference, bearer: issued.bearer }, {}),
      'inactive-seller',
    );
  });
});

describe('touchSellerCredentialUsed', () => {
  it('records last use without touching anything else', () => {
    const store = testStore();
    const { credential } = issueSellerCredential(
      store, { tenantId: 'tenant-a', sellerId: 'seller-1' }, { generateId, bearerHex: BEARER_HEX },
    );
    assert.equal(credential.lastUsedAt, null);
    touchSellerCredentialUsed(store, { tenantId: 'tenant-a', credentialId: credential.id }, { now: '2026-06-02T10:00:00.000Z' });
    assert.equal(credential.lastUsedAt, '2026-06-02T10:00:00.000Z');
    assert.equal(credential.status, 'ACTIVE');
  });
});
