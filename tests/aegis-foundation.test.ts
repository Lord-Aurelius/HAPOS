import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { AiError, toAiError } from '../src/server/aegis/errors.ts';
import { resolveShopContext } from '../src/server/aegis/grounding.ts';
import type { CapabilityDef } from '../src/server/aegis/registry.ts';
import { inRange, isCapabilityAllowed, paginate, validateCapabilityArgs } from '../src/server/aegis/registry.ts';
import { CommerceError } from '../src/server/commerce/orders.ts';
import { SellerError } from '../src/server/commerce/seller.ts';

const TENANTS = [
  { id: 'tenant-a', name: 'Shop A', slug: 'shop-a' },
  { id: 'tenant-b', name: 'Shop B', slug: 'shop-b' },
];

describe('toAiError', () => {
  it('passes AiError through and maps domain errors to codes', () => {
    const direct = new AiError('NOT_FOUND', 'gone', false);
    assert.equal(toAiError(direct), direct);
    assert.equal(toAiError(new CommerceError('unknown-item', 'nope')).code, 'NOT_FOUND');
    assert.equal(toAiError(new CommerceError('cross-tenant-item', 'nope')).code, 'WRONG_TENANT');
    assert.equal(toAiError(new CommerceError('not-permitted', 'nope')).code, 'FORBIDDEN');
    assert.equal(toAiError(new CommerceError('already-approved', 'nope')).code, 'ALREADY_COMPLETED');
    assert.equal(toAiError(new CommerceError('insufficient-stock', 'nope')).code, 'CONFLICT');
    assert.equal(toAiError(new CommerceError('empty-order', 'nope')).code, 'INVALID_ARGUMENT');
    assert.equal(toAiError(new SellerError('invalid-reference', 'nope')).code, 'NOT_FOUND');
    assert.equal(toAiError(new SellerError('credential-revoked', 'nope')).code, 'FORBIDDEN');
    const timeout = toAiError(Object.assign(new Error('x'), { code: 'gateway-timeout' }));
    assert.equal(timeout.code, 'TEMPORARY_FAILURE');
    assert.equal(timeout.retryable, true);
    const unknown = toAiError(new Error('db exploded: password=hunter2'));
    assert.equal(unknown.code, 'INTERNAL_ERROR');
    assert.ok(!unknown.message.includes('hunter2'));
  });
});

describe('resolveShopContext', () => {
  it('pins normal principals to their tenant', () => {
    const shop = resolveShopContext(TENANTS, { kind: 'user', tenantId: 'tenant-a' }, undefined);
    assert.deepEqual(shop, { tenantId: 'tenant-a', shopId: 'tenant-a', shopName: 'Shop A' });
    assert.throws(
      () => resolveShopContext(TENANTS, { kind: 'user', tenantId: 'tenant-a' }, 'tenant-b'),
      (error: unknown) => error instanceof AiError && error.code === 'WRONG_SHOP',
    );
    assert.throws(
      () => resolveShopContext(TENANTS, { kind: 'user', tenantId: 'tenant-gone' }, undefined),
      (error: unknown) => error instanceof AiError && error.code === 'WRONG_TENANT',
    );
  });

  it('grounds master only to real registry shops', () => {
    const shop = resolveShopContext(TENANTS, { kind: 'master' }, 'tenant-b');
    assert.deepEqual(shop, { tenantId: 'tenant-b', shopId: 'tenant-b', shopName: 'Shop B' });
    assert.throws(
      () => resolveShopContext(TENANTS, { kind: 'master' }, undefined),
      (error: unknown) => error instanceof AiError && error.code === 'INVALID_ARGUMENT',
    );
    assert.throws(
      () => resolveShopContext(TENANTS, { kind: 'master' }, 'tenant-invented'),
      (error: unknown) => error instanceof AiError && error.code === 'WRONG_SHOP',
    );
  });
});

describe('capability registry helpers', () => {
  const readDef: CapabilityDef = { id: 'products.list', domain: 'Products', description: 'x', type: 'read', risk: 'low', params: {}, roles: ['shop_admin', 'staff', 'super_admin'], handler: async () => null };
  const adminRead: CapabilityDef = { ...readDef, id: 'expenses.list' };
  const actionDef: CapabilityDef = { ...readDef, id: 'orders.approve', type: 'action', risk: 'medium' };
  const adminAction: CapabilityDef = { ...readDef, id: 'expenses.create', type: 'action', risk: 'medium' };

  it('enforces the role matrix with master bypass', () => {
    assert.equal(isCapabilityAllowed('master', readDef), true);
    assert.equal(isCapabilityAllowed('master', actionDef), true);
    assert.equal(isCapabilityAllowed('super_admin', actionDef), true);
    assert.equal(isCapabilityAllowed('shop_admin', actionDef), true);
    assert.equal(isCapabilityAllowed('staff', readDef), true);
    assert.equal(isCapabilityAllowed('staff', adminRead), false);
    // Staff may invoke approval (the domain enforces per-order admin rights),
    // but never admin-only writes.
    assert.equal(isCapabilityAllowed('staff', actionDef), true);
    assert.equal(isCapabilityAllowed('staff', adminAction), false);
    assert.equal(isCapabilityAllowed('customer', readDef), false);
    assert.equal(isCapabilityAllowed('', readDef), false);
  });

  it('validates schemas with required and typed params', () => {
    const def: CapabilityDef = {
      ...readDef,
      params: {
        orderId: { type: 'string', description: 'Order id.', required: true },
        limit: { type: 'number', description: 'Max rows.' },
      },
    };
    assert.equal(validateCapabilityArgs(def, { orderId: 'o-1' }), null);
    assert.equal(validateCapabilityArgs(def, {}), 'Missing required parameter: orderId.');
    assert.equal(validateCapabilityArgs(def, { orderId: 42 }), 'Parameter orderId must be a string.');
    assert.equal(validateCapabilityArgs(def, { orderId: 'o-1', limit: 'many' }), 'Parameter limit must be a number.');
  });

  it('bounds pagination', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    assert.deepEqual(paginate(items, {}), { items: items.slice(0, 20), total: 250, limit: 20, offset: 0 });
    const capped = paginate(items, { limit: 5000, offset: 240 });
    assert.equal(capped.limit, 100);
    assert.equal(capped.items.length, 10);
  });

  it('ranges dates inclusively with open ends', () => {
    assert.equal(inRange('2026-09-17T10:00:00.000Z', undefined, undefined), true);
    assert.equal(inRange('2026-09-17T10:00:00.000Z', '2026-09-17T00:00:00.000Z', '2026-09-18T00:00:00.000Z'), true);
    assert.equal(inRange('2026-09-16T10:00:00.000Z', '2026-09-17T00:00:00.000Z', undefined), false);
    assert.equal(inRange('not-a-date', '2026-09-17T00:00:00.000Z', undefined), false);
    assert.equal(inRange(null, '2026-09-17T00:00:00.000Z', undefined), false);
  });
});
