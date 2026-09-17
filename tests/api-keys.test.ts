import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiKeyError,
  hashApiKey,
  isApiKeyUsable,
  listApiKeyMetadata,
  mintApiKey,
  resolveApiKeyPrincipal,
  revokeApiKey,
  touchApiKeyUsed,
  type ApiKeyStore,
} from '../src/server/auth/api-keys.ts';

function keyStore(): ApiKeyStore {
  return {
    users: [
      { id: 'admin-1', tenantId: 'tenant-a', role: 'shop_admin', isActive: true },
      { id: 'staff-1', tenantId: 'tenant-a', role: 'staff', isActive: true },
      { id: 'idle-1', tenantId: 'tenant-a', role: 'staff', isActive: false },
      { id: 'foreign-1', tenantId: 'tenant-b', role: 'shop_admin', isActive: true },
    ],
    apiKeys: [],
  };
}

describe('mintApiKey', () => {
  it('mints a normal key bound to tenant + user, secret shown once', () => {
    const store = keyStore();
    const minted = mintApiKey(
      store,
      { scope: 'normal', tenantId: 'tenant-a', userId: 'staff-1', name: 'AEGIS link', createdBy: 'admin-1', minterRole: 'shop_admin' },
      { now: '2026-09-17T10:00:00.000Z', generateId: () => 'key-1', secretHex: 'a'.repeat(48) },
    );
    assert.ok(minted.secret.startsWith('hap_live_'));
    assert.equal(minted.record.keyHash, hashApiKey(minted.secret));
    assert.ok(!('secret' in minted.record));
    assert.equal(minted.record.tenantId, 'tenant-a');
    assert.equal(minted.record.userId, 'staff-1');
    const listed = listApiKeyMetadata(store, { tenantId: 'tenant-a', includeMaster: false });
    assert.equal(listed.length, 1);
    assert.ok(!('keyHash' in listed[0]));
  });

  it('rejects unbound normal keys and foreign users', () => {
    const store = keyStore();
    assert.throws(
      () => mintApiKey(store, { scope: 'normal', tenantId: null, userId: 'staff-1', name: 'x', createdBy: null, minterRole: 'shop_admin' }, {}),
      (error: unknown) => error instanceof ApiKeyError && error.code === 'missing-binding',
    );
    assert.throws(
      () => mintApiKey(store, { scope: 'normal', tenantId: 'tenant-a', userId: 'foreign-1', name: 'x', createdBy: null, minterRole: 'shop_admin' }, {}),
      (error: unknown) => error instanceof ApiKeyError && error.code === 'missing-binding',
    );
    assert.throws(
      () => mintApiKey(store, { scope: 'normal', tenantId: 'tenant-a', userId: 'staff-1', name: '  ', createdBy: null, minterRole: 'shop_admin' }, {}),
      (error: unknown) => error instanceof ApiKeyError && error.code === 'invalid-name',
    );
  });

  it('mints master keys only for the platform authority, unbound', () => {
    const store = keyStore();
    const minted = mintApiKey(
      store,
      { scope: 'master', name: 'Platform maintenance', createdBy: 'super-1', minterRole: 'super_admin' },
      { generateId: () => 'key-master', secretHex: 'b'.repeat(48) },
    );
    assert.equal(minted.record.tenantId, null);
    assert.equal(minted.record.userId, null);
    assert.throws(
      () => mintApiKey(store, { scope: 'master', name: 'x', createdBy: 'admin-1', minterRole: 'shop_admin' }, {}),
      (error: unknown) => error instanceof ApiKeyError && error.code === 'forbidden',
    );
    // Hidden from normal listings.
    assert.equal(listApiKeyMetadata(store, { tenantId: 'tenant-a', includeMaster: false }).length, 0);
    assert.equal(listApiKeyMetadata(store, { tenantId: null, includeMaster: true }).length, 1);
  });
});

describe('resolveApiKeyPrincipal', () => {
  it('resolves a live bound user with their current role', () => {
    const store = keyStore();
    const minted = mintApiKey(
      store,
      { scope: 'normal', tenantId: 'tenant-a', userId: 'staff-1', name: 'AEGIS', createdBy: null, minterRole: 'shop_admin' },
      { generateId: () => 'key-1', secretHex: 'c'.repeat(48) },
    );
    const principal = resolveApiKeyPrincipal(store, minted.secret);
    assert.deepEqual(principal, { kind: 'normal', keyId: 'key-1', tenantId: 'tenant-a', userId: 'staff-1', role: 'staff' });
  });

  it('resolves master keys without tenant binding', () => {
    const store = keyStore();
    const minted = mintApiKey(store, { scope: 'master', name: 'm', createdBy: null, minterRole: 'super_admin' }, { generateId: () => 'km', secretHex: 'd'.repeat(48) });
    assert.deepEqual(resolveApiKeyPrincipal(store, minted.secret), { kind: 'master', keyId: 'km' });
  });

  it('fails closed on wrong, revoked, expired and orphaned credentials', () => {
    const store = keyStore();
    const minted = mintApiKey(
      store,
      { scope: 'normal', tenantId: 'tenant-a', userId: 'staff-1', name: 'AEGIS', createdBy: null, minterRole: 'shop_admin' },
      { generateId: () => 'key-1', secretHex: 'e'.repeat(48) },
    );
    assert.equal(resolveApiKeyPrincipal(store, 'hap_live_' + '0'.repeat(48)), null);
    assert.equal(resolveApiKeyPrincipal(store, 'not-a-key'), null);
    assert.equal(resolveApiKeyPrincipal(store, 42), null);

    revokeApiKey(store, { id: 'key-1', tenantId: 'tenant-a' }, { now: '2026-09-17T11:00:00.000Z' });
    assert.equal(resolveApiKeyPrincipal(store, minted.secret, { now: '2026-09-17T12:00:00.000Z' }), null);

    const expiring = mintApiKey(
      store,
      { scope: 'normal', tenantId: 'tenant-a', userId: 'staff-1', name: 'short', createdBy: null, minterRole: 'shop_admin', expiresAt: '2026-01-01T00:00:00.000Z' },
      { generateId: () => 'key-2', secretHex: 'f'.repeat(48) },
    );
    assert.equal(isApiKeyUsable(store.apiKeys.find((row) => row.id === 'key-2')!, '2026-09-17T00:00:00.000Z'), false);
    assert.equal(resolveApiKeyPrincipal(store, expiring.secret, { now: '2026-09-17T00:00:00.000Z' }), null);

    const idle = mintApiKey(
      store,
      { scope: 'normal', tenantId: 'tenant-a', userId: 'idle-1', name: 'idle', createdBy: null, minterRole: 'shop_admin' },
      { generateId: () => 'key-3', secretHex: '1'.repeat(48) },
    );
    assert.equal(resolveApiKeyPrincipal(store, idle.secret), null);
  });

  it('guards revocation by scope and tenant', () => {
    const store = keyStore();
    mintApiKey(store, { scope: 'master', name: 'm', createdBy: null, minterRole: 'super_admin' }, { generateId: () => 'km' });
    assert.throws(
      () => revokeApiKey(store, { id: 'km', tenantId: 'tenant-a' }),
      (error: unknown) => error instanceof ApiKeyError && error.code === 'forbidden',
    );
    const row = revokeApiKey(store, { id: 'km', scope: 'master' }, { now: '2026-09-17T11:00:00.000Z' });
    assert.equal(row.status, 'REVOKED');

    mintApiKey(store, { scope: 'normal', tenantId: 'tenant-a', userId: 'staff-1', name: 'n', createdBy: null, minterRole: 'shop_admin' }, { generateId: () => 'kn' });
    assert.throws(
      () => revokeApiKey(store, { id: 'kn', tenantId: 'tenant-b' }),
      (error: unknown) => error instanceof ApiKeyError && error.code === 'unknown-key',
    );
    assert.throws(
      () => revokeApiKey(store, { id: 'missing' }),
      (error: unknown) => error instanceof ApiKeyError && error.code === 'unknown-key',
    );
  });

  it('touches last-used at most hourly', () => {
    const store = keyStore();
    mintApiKey(store, { scope: 'normal', tenantId: 'tenant-a', userId: 'staff-1', name: 'n', createdBy: null, minterRole: 'shop_admin' }, { generateId: () => 'kn', now: '2026-09-17T10:00:00.000Z' });
    touchApiKeyUsed(store, { id: 'kn' }, { now: '2026-09-17T10:00:00.000Z' });
    assert.equal(store.apiKeys[0].lastUsedAt, '2026-09-17T10:00:00.000Z');
    touchApiKeyUsed(store, { id: 'kn' }, { now: '2026-09-17T10:30:00.000Z' });
    assert.equal(store.apiKeys[0].lastUsedAt, '2026-09-17T10:00:00.000Z');
    touchApiKeyUsed(store, { id: 'kn' }, { now: '2026-09-17T12:00:00.000Z' });
    assert.equal(store.apiKeys[0].lastUsedAt, '2026-09-17T12:00:00.000Z');
  });
});
