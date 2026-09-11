import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  IdempotencyKeyError,
  claimIdempotentSale,
  findExistingSaleRecord,
  normalizeIdempotencyKey,
} from '../src/server/commerce/idempotency.ts';
import { makeServiceRecord } from './fixtures.ts';

describe('normalizeIdempotencyKey', () => {
  it('accepts UUID-shaped keys', () => {
    assert.equal(normalizeIdempotencyKey('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
  });

  it('resolves missing/blank keys to null (caller generates a fresh key)', () => {
    assert.equal(normalizeIdempotencyKey(null), null);
    assert.equal(normalizeIdempotencyKey(undefined), null);
    assert.equal(normalizeIdempotencyKey('   '), null);
  });

  it('rejects malformed keys instead of weakening the contract', () => {
    assert.throws(() => normalizeIdempotencyKey('short'), IdempotencyKeyError);
    assert.throws(() => normalizeIdempotencyKey('key with spaces!!!!'), IdempotencyKeyError);
    assert.throws(() => normalizeIdempotencyKey('x'.repeat(129)), IdempotencyKeyError);
  });
});

describe('findExistingSaleRecord', () => {
  it('returns null without a key', () => {
    assert.equal(findExistingSaleRecord([makeServiceRecord()], 'tenant-test-shop', null), null);
  });

  it('scopes lookups to the tenant', () => {
    const record = makeServiceRecord({ idempotencyKey: 'shared-key-123' });
    assert.equal(findExistingSaleRecord([record], 'tenant-other', 'shared-key-123'), null);
    assert.equal(findExistingSaleRecord([record], 'tenant-test-shop', 'shared-key-123')?.id, record.id);
  });
});

describe('claimIdempotentSale (exactly-once semantics)', () => {
  it('first submission creates, identical retry returns the existing record', () => {
    const records: ReturnType<typeof makeServiceRecord>[] = [];
    const key = 'idem-key-0001';
    let creations = 0;

    const first = claimIdempotentSale(records, 'tenant-test-shop', key, () => {
      creations += 1;
      const record = makeServiceRecord({ idempotencyKey: key });
      records.push(record);
      return record;
    });
    assert.equal(first.duplicate, false);

    const retry = claimIdempotentSale(records, 'tenant-test-shop', key, () => {
      creations += 1;
      const record = makeServiceRecord({ idempotencyKey: key });
      records.push(record);
      return record;
    });
    assert.equal(retry.duplicate, true);
    assert.equal(retry.record.id, first.record.id);
    assert.equal(creations, 1);
    assert.equal(records.length, 1);
  });

  it('concurrent duplicate submissions collapse to one record', () => {
    const records: ReturnType<typeof makeServiceRecord>[] = [];
    const key = 'idem-key-0002';
    // Both claims run inside the same atomic mutator in production; model that
    // by executing both against the same array without yielding.
    const outcomes = [0, 1].map(() =>
      claimIdempotentSale(records, 'tenant-test-shop', key, () => {
        const record = makeServiceRecord({ idempotencyKey: key });
        records.push(record);
        return record;
      }),
    );
    assert.equal(records.length, 1);
    assert.deepEqual(
      outcomes.map((o) => o.record.id),
      [records[0].id, records[0].id],
    );
    assert.ok(outcomes.some((o) => o.duplicate));
  });

  it('different keys create distinct transactions', () => {
    const records: ReturnType<typeof makeServiceRecord>[] = [];
    for (const key of ['idem-key-0003', 'idem-key-0004']) {
      const claimed = claimIdempotentSale(records, 'tenant-test-shop', key, () => {
        const record = makeServiceRecord({ idempotencyKey: key });
        records.push(record);
        return record;
      });
      assert.equal(claimed.duplicate, false);
    }
    assert.equal(records.length, 2);
  });
});
