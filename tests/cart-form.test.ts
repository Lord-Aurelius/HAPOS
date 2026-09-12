import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CartFormError, parseCartFormEntries } from '../src/server/commerce/cart-form.ts';

function entriesOf(rows: Record<string, string>): [string, string][] {
  return Object.entries(rows);
}

function assertCartCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof CartFormError && error.code === code,
    `expected CartFormError ${code}`,
  );
}

describe('parseCartFormEntries (quantity contract)', () => {
  it('skips untouched rows even though kind always submits', () => {
    // Regression lock for the phantom-line defect: kind selects always post
    // a value, so skipping must key on the blank item reference.
    const lines = parseCartFormEntries(
      entriesOf({
        line_0_kind: 'service',
        line_0_refId: 'svc-cut',
        line_0_quantity: '1',
        line_1_kind: 'service',
        line_1_refId: '',
        line_1_quantity: '1',
        line_2_kind: 'product',
        line_2_refId: '',
        line_2_quantity: '',
        line_3_kind: 'service',
        line_3_refId: '',
        line_3_quantity: '',
      }),
    );
    assert.equal(lines.length, 1);
    assert.deepEqual(lines[0], {
      kind: 'service',
      refId: 'svc-cut',
      quantity: 1,
      actualUnitPrice: null,
      overrideReason: null,
    });
  });

  it('accepts string and numeric quantities >= 1', () => {
    const lines = parseCartFormEntries(
      entriesOf({
        line_0_kind: 'product',
        line_0_refId: 'prod-oil',
        line_0_quantity: '1',
        line_1_kind: 'product',
        line_1_refId: 'prod-dye',
        line_1_quantity: '2',
        line_2_kind: 'service',
        line_2_refId: 'svc-cut',
        line_2_quantity: '3',
      }),
    );
    assert.deepEqual(
      lines.map((line) => [line.refId, line.quantity]),
      [
        ['prod-oil', 1],
        ['prod-dye', 2],
        ['svc-cut', 3],
      ],
    );
  });

  it('rejects empty, zero, negative, fractional and malformed quantities', () => {
    for (const bad of ['', '0', '-1', '1.5', 'abc', 'NaN', 'Infinity']) {
      assertCartCode(
        () =>
          parseCartFormEntries(
            entriesOf({ line_0_kind: 'product', line_0_refId: 'prod-oil', line_0_quantity: bad }),
          ),
        'invalid-quantity',
      );
    }
  });

  it('rejects empty carts and unknown item types', () => {
    assertCartCode(() => parseCartFormEntries(entriesOf({})), 'empty-order');
    assertCartCode(
      () =>
        parseCartFormEntries(
          entriesOf({ line_0_kind: 'weird', line_0_refId: 'prod-oil', line_0_quantity: '1' }),
        ),
      'unknown-item',
    );
  });

  it('parses actual prices explicitly (blank means catalog)', () => {
    const lines = parseCartFormEntries(
      entriesOf({
        line_0_kind: 'product',
        line_0_refId: 'prod-oil',
        line_0_quantity: '2',
        line_0_actual: '700',
        line_0_reason: 'Loyalty',
      }),
    );
    assert.equal(lines[0].actualUnitPrice, 700);
    assert.equal(lines[0].overrideReason, 'Loyalty');
    assertCartCode(
      () =>
        parseCartFormEntries(
          entriesOf({ line_0_kind: 'product', line_0_refId: 'prod-oil', line_0_quantity: '1', line_0_actual: 'nope' }),
        ),
      'invalid-price',
    );
  });
});
