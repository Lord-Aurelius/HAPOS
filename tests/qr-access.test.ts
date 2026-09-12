import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  QrAccessError,
  checkQrTenantAccess,
} from '../src/server/auth/qr-access.ts';

function assertQrCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof QrAccessError && error.code === code,
    `expected QrAccessError ${code}`,
  );
}

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

describe('checkQrTenantAccess (QR ownership)', () => {
  it('lets a shop admin manage their own tenant QR material', () => {
    assert.doesNotThrow(() =>
      checkQrTenantAccess({ user: { role: 'shop_admin' }, tenant: { id: TENANT_A } }, TENANT_A),
    );
  });

  it('blocks a shop admin on another tenant (all three QR systems)', () => {
    assertQrCode(
      () => checkQrTenantAccess({ user: { role: 'shop_admin' }, tenant: { id: TENANT_A } }, TENANT_B),
      'cross-tenant',
    );
  });

  it('denies staff everywhere (no QR management role)', () => {
    assertQrCode(
      () => checkQrTenantAccess({ user: { role: 'staff' }, tenant: { id: TENANT_A } }, TENANT_A),
      'forbidden-role',
    );
    assertQrCode(
      () => checkQrTenantAccess({ user: { role: 'staff' }, tenant: { id: TENANT_A } }, TENANT_B),
      'forbidden-role',
    );
  });

  it('retains super-admin platform support across tenants', () => {
    assert.doesNotThrow(() => checkQrTenantAccess({ user: { role: 'super_admin' }, tenant: null }, TENANT_A));
    assert.doesNotThrow(() => checkQrTenantAccess({ user: { role: 'super_admin' }, tenant: null }, TENANT_B));
  });

  it('denies shop context loss (non-super session without tenant)', () => {
    assertQrCode(
      () => checkQrTenantAccess({ user: { role: 'shop_admin' }, tenant: null }, TENANT_A),
      'missing-context',
    );
  });
});
