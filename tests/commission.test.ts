import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { calculateCommerceCommission } from '../src/server/commerce/commission.ts';

describe('calculateCommerceCommission (baseline behaviour lock)', () => {
  it('computes percentage commission with rounding', () => {
    // 10% of 1000 — matches StoreServiceRecord.commissionAmount semantics.
    assert.deepEqual(
      calculateCommerceCommission({
        service: { commissionType: 'percentage', commissionValue: 10 },
        staff: null,
        price: 1000,
      }),
      { commissionType: 'percentage', commissionValue: 10, commissionAmount: 100 },
    );
  });

  it('rounds fractional percentage commissions (Math.round)', () => {
    // 10% of 1999 = 199.9 -> 200. Locks the historical rounding rule.
    const result = calculateCommerceCommission({
      service: { commissionType: 'percentage', commissionValue: 10 },
      staff: null,
      price: 1999,
    });
    assert.equal(result.commissionAmount, 200);
  });

  it('pays fixed commissions verbatim', () => {
    const result = calculateCommerceCommission({
      service: { commissionType: 'fixed', commissionValue: 350 },
      staff: null,
      price: 1000,
    });
    assert.equal(result.commissionAmount, 350);
    assert.equal(result.commissionType, 'fixed');
  });

  it('prefers staff terms over service terms', () => {
    const result = calculateCommerceCommission({
      service: { commissionType: 'percentage', commissionValue: 5 },
      staff: { commissionType: 'percentage', commissionValue: 20 },
      price: 1000,
    });
    assert.equal(result.commissionValue, 20);
    assert.equal(result.commissionAmount, 200);
  });

  it('falls back to percentage/0 when no terms exist', () => {
    assert.deepEqual(calculateCommerceCommission({ price: 1000 }), {
      commissionType: 'percentage',
      commissionValue: 0,
      commissionAmount: 0,
    });
  });
});
