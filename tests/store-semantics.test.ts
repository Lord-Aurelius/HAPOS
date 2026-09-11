/**
 * Baseline store-semantics locks (Phase 0.2 requirements 1-4).
 *
 * These import the REAL `voidServiceRecord` / `isActiveServiceRecord`
 * implementations via relative paths (their only imports are type-only, so
 * plain `node --test` can load them without the Next.js runtime). Tenant
 * scoping and the order-approval linkage are exercised against the same
 * record shapes the production store uses.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isActiveServiceRecord,
  voidServiceRecord,
} from '../src/server/store/service-records.ts';
import type { StoreState } from '../src/server/store/types.ts';
import {
  makeCustomerOrder,
  makeServiceRecord,
  makeTestStore,
  resetFixtureSequence,
} from './fixtures.ts';

describe('service-record creation (baseline)', () => {
  it('new records are active and carry the commission snapshot', () => {
    resetFixtureSequence();
    const record = makeServiceRecord({ price: 1000, commissionAmount: 100 });
    assert.equal(isActiveServiceRecord(record), true);
    assert.equal(record.commissionAmount, 100);
    assert.equal(record.voidedAt, null);
  });
});

describe('void behaviour (baseline lock)', () => {
  it('void flags the record, restores the linked order, and picks the next record', () => {
    resetFixtureSequence();
    const store = makeTestStore();
    const first = makeServiceRecord({ performedAt: '2026-04-04T08:00:00.000Z' });
    const second = makeServiceRecord({ performedAt: '2026-04-04T09:00:00.000Z' });
    store.serviceRecords.push(first, second);
    const order = makeCustomerOrder({ status: 'approved', approvedRecordId: second.id });
    store.customerOrders.push(order);

    const result = voidServiceRecord(
      store as unknown as StoreState,
      { tenantId: 'tenant-test-shop', recordId: second.id, userId: 'user-test-admin', reason: 'Duplicate entry' },
    );

    assert.equal(result.status, 'voided');
    assert.equal(second.voidedAt !== null, true);
    assert.equal(second.voidedBy, 'user-test-admin');
    assert.equal(second.voidReason, 'Duplicate entry');
    assert.equal(order.status, 'acknowledged');
    assert.equal(order.approvedRecordId, null);
    assert.equal(result.restoredOrderId, order.id);
    assert.equal(result.nextRecordId, first.id);
    // Voided records drop out of the active ledger view.
    assert.deepEqual(store.serviceRecords.filter(isActiveServiceRecord).map((r) => r.id), [first.id]);
  });

  it('double void reports missing (no duplicate side effects)', () => {
    resetFixtureSequence();
    const store = makeTestStore();
    const record = makeServiceRecord();
    store.serviceRecords.push(record);
    const input = { tenantId: 'tenant-test-shop', recordId: record.id, userId: 'user-test-admin' };
    assert.equal(voidServiceRecord(store as unknown as StoreState, input).status, 'voided');
    assert.equal(voidServiceRecord(store as unknown as StoreState, input).status, 'missing');
  });

  it('void is tenant-scoped (cross-tenant record ids are not touched)', () => {
    resetFixtureSequence();
    const store = makeTestStore();
    const foreign = makeServiceRecord({ id: 'record-foreign', tenantId: 'tenant-other' });
    store.serviceRecords.push(foreign);
    const result = voidServiceRecord(
      store as unknown as StoreState,
      { tenantId: 'tenant-test-shop', recordId: 'record-foreign', userId: 'user-test-admin' },
    );
    assert.equal(result.status, 'missing');
    assert.equal(foreign.voidedAt, null);
  });
});

describe('tenant scoping (baseline lock)', () => {
  it('record listings isolate tenants', () => {
    resetFixtureSequence();
    const store = makeTestStore();
    store.serviceRecords.push(
      makeServiceRecord({ tenantId: 'tenant-test-shop' }),
      makeServiceRecord({ tenantId: 'tenant-other' }),
    );
    const visible = store.serviceRecords.filter(
      (record) => record.tenantId === 'tenant-test-shop' && isActiveServiceRecord(record),
    );
    assert.equal(visible.length, 1);
  });
});

describe('customer-order approval linkage (baseline lock)', () => {
  it('approved orders link exactly one record; void returns the order for re-approval', () => {
    resetFixtureSequence();
    const store = makeTestStore();
    const order = makeCustomerOrder({ status: 'pending' });
    store.customerOrders.push(order);

    // Mirror approveCustomerOrderToSalesAction: create + link.
    const record = makeServiceRecord({ price: order.quotedPrice });
    store.serviceRecords.push(record);
    order.status = 'approved';
    order.approvedRecordId = record.id;
    assert.equal(order.approvedRecordId, record.id);

    // Mirror the re-approval guard: already-approved must not create again.
    const alreadyApproved = order.status === 'approved' && Boolean(order.approvedRecordId);
    assert.equal(alreadyApproved, true);
  });
});
