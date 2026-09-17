import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  MutationError,
  createExpenseRecord,
  createMarketplaceAdvert,
} from '../src/server/services/aegis-mutations.ts';

let sequence = 0;
function generateId() {
  sequence += 1;
  return `aegis-mutation-${sequence}`;
}

function mutationStore() {
  return {
    expenses: [],
    subscriptions: [{ tenantId: 'tenant-a', packageId: 'package-platinum', planCode: 'platinum' }],
    subscriptionPackages: [{ id: 'package-platinum', code: 'platinum', includesMarketplace: true }],
    marketplaceAds: [],
  };
}

describe('createExpenseRecord', () => {
  it('creates with canonical validation and converges on idempotency key', () => {
    const store = mutationStore();
    const first = createExpenseRecord(
      store,
      { tenantId: 'tenant-a', category: 'Supplies', amount: 1500, expenseDate: '2026-09-10', description: 'Oil', createdBy: 'admin-1', idempotencyKey: 'exp-key-1' },
      { generateId, now: '2026-09-17T10:00:00.000Z' },
    );
    assert.equal(first.duplicate, false);
    assert.equal(first.record.category, 'Supplies');
    const retry = createExpenseRecord(
      store,
      { tenantId: 'tenant-a', category: 'Supplies', amount: 1500, expenseDate: '2026-09-10', description: 'Oil', createdBy: 'admin-1', idempotencyKey: 'exp-key-1' },
      { generateId, now: '2026-09-17T10:01:00.000Z' },
    );
    assert.equal(retry.duplicate, true);
    assert.equal(retry.record.id, first.record.id);
    assert.equal(store.expenses.length, 1);
  });

  it('rejects invalid input through canonical validators', () => {
    const store = mutationStore();
    assert.throws(
      () => createExpenseRecord(store, { tenantId: 'tenant-a', category: '  ', amount: 10, expenseDate: '2026-09-10', createdBy: 'x' }, { generateId }),
      /category/i,
    );
    assert.throws(
      () => createExpenseRecord(store, { tenantId: 'tenant-a', category: 'Supplies', amount: -5, expenseDate: '2026-09-10', createdBy: 'x' }, { generateId }),
    );
    assert.throws(
      () => createExpenseRecord(store, { tenantId: 'tenant-a', category: 'Supplies', amount: 10, expenseDate: 'next friday', createdBy: 'x' }, { generateId }),
    );
    assert.equal(store.expenses.length, 0);
  });
});

describe('createMarketplaceAdvert', () => {
  it('creates pending adverts and converges on idempotency key', () => {
    const store = mutationStore();
    const first = createMarketplaceAdvert(
      store,
      { tenantId: 'tenant-a', title: 'Weekend offer', body: '20% off cuts', createdBy: 'admin-1', creatorName: 'Otis', idempotencyKey: 'ad-key-1' },
      { generateId, now: '2026-09-17T10:00:00.000Z' },
    );
    assert.equal(first.duplicate, false);
    assert.equal(first.record.status, 'pending');
    assert.equal(first.record.contactName, 'Otis');
    assert.equal(first.record.imageUrl, null);
    const retry = createMarketplaceAdvert(
      store,
      { tenantId: 'tenant-a', title: 'Weekend offer', body: '20% off cuts', createdBy: 'admin-1', idempotencyKey: 'ad-key-1' },
      { generateId, now: '2026-09-17T10:01:00.000Z' },
    );
    assert.equal(retry.duplicate, true);
    assert.equal(store.marketplaceAds.length, 1);
  });

  it('enforces the platinum gate and non-blank content', () => {
    const store = mutationStore();
    store.subscriptions = [{ tenantId: 'tenant-a', packageId: 'package-basic', planCode: 'basic' }];
    store.subscriptionPackages = [{ id: 'package-basic', code: 'basic', includesMarketplace: false }];
    assert.throws(
      () => createMarketplaceAdvert(store, { tenantId: 'tenant-a', title: 'Hi', body: 'Hello', createdBy: 'admin-1', idempotencyKey: 'k' }, { generateId }),
      (error: unknown) => error instanceof MutationError && error.code === 'not-permitted',
    );
    store.subscriptions = [{ tenantId: 'tenant-a', packageId: 'package-platinum', planCode: 'platinum' }];
    store.subscriptionPackages = [{ id: 'package-platinum', code: 'platinum', includesMarketplace: true }];
    assert.throws(
      () => createMarketplaceAdvert(store, { tenantId: 'tenant-a', title: '  ', body: 'Hello', createdBy: 'admin-1', idempotencyKey: 'k' }, { generateId }),
    );
    assert.equal(store.marketplaceAds.length, 0);
  });
});
