import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  PaymentError,
  assertConfirmationAmount,
  assertInitiationAmount,
  buildPaymentIdempotencyKey,
  isPaymentExpired,
  isTerminalPaymentStatus,
  maskCustomerPhone,
  transitionPaymentStatus,
} from '../src/server/commerce/payments.ts';

function assertPaymentCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof PaymentError && error.code === code,
    `expected PaymentError ${code}`,
  );
}

describe('transitionPaymentStatus', () => {
  it('allows the terminal fan-out from PENDING', () => {
    assert.equal(transitionPaymentStatus('PENDING', 'SUCCESS'), 'SUCCESS');
    assert.equal(transitionPaymentStatus('PENDING', 'FAILED'), 'FAILED');
    assert.equal(transitionPaymentStatus('PENDING', 'EXPIRED'), 'EXPIRED');
    assert.equal(transitionPaymentStatus('PENDING', 'CANCELLED'), 'CANCELLED');
  });

  it('freezes terminal states (SUCCESS never reverts)', () => {
    for (const terminal of ['SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED'] as const) {
      assertPaymentCode(() => transitionPaymentStatus(terminal, 'PENDING'), 'invalid-transition');
      assertPaymentCode(() => transitionPaymentStatus(terminal, 'SUCCESS'), 'invalid-transition');
      assert.equal(isTerminalPaymentStatus(terminal), true);
    }
    assert.equal(isTerminalPaymentStatus('PENDING'), false);
  });
});

describe('assertInitiationAmount', () => {
  it('accepts positive server totals and rejects the rest', () => {
    assert.equal(assertInitiationAmount(1850), 1850);
    assertPaymentCode(() => assertInitiationAmount(0), 'invalid-amount');
    assertPaymentCode(() => assertInitiationAmount(-5), 'invalid-amount');
    assertPaymentCode(() => assertInitiationAmount(Number.NaN), 'invalid-amount');
  });
});

describe('assertConfirmationAmount', () => {
  it('accepts matching confirmations within tolerance', () => {
    assert.doesNotThrow(() =>
      assertConfirmationAmount({ authoritativeTotal: 1850, reportedTotal: 1850, currency: 'KES', reportedCurrency: 'KES' }),
    );
    assert.doesNotThrow(() =>
      assertConfirmationAmount({ authoritativeTotal: 1850, reportedTotal: 1850.004, currency: 'KES' }),
    );
  });

  it('rejects mismatches, missing amounts and currency drift', () => {
    assertPaymentCode(
      () => assertConfirmationAmount({ authoritativeTotal: 1850, reportedTotal: 1800, currency: 'KES' }),
      'amount-mismatch',
    );
    assertPaymentCode(
      () => assertConfirmationAmount({ authoritativeTotal: 1850, reportedTotal: null, currency: 'KES' }),
      'amount-mismatch',
    );
    assertPaymentCode(
      () => assertConfirmationAmount({ authoritativeTotal: 1850, reportedTotal: 1850, currency: 'KES', reportedCurrency: 'USD' }),
      'amount-mismatch',
    );
  });
});

describe('isPaymentExpired / buildPaymentIdempotencyKey', () => {
  it('evaluates expiry against the server clock', () => {
    assert.equal(isPaymentExpired(null, '2026-06-01T00:00:00.000Z'), false);
    assert.equal(isPaymentExpired('2026-07-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'), false);
    assert.equal(isPaymentExpired('2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'), true);
  });

  it('builds stable per-attempt keys', () => {
    assert.equal(buildPaymentIdempotencyKey('order-1', 1), 'pay-order-1-1');
    assert.equal(buildPaymentIdempotencyKey('order-1', 1), buildPaymentIdempotencyKey('order-1', 1));
    assert.notEqual(buildPaymentIdempotencyKey('order-1', 1), buildPaymentIdempotencyKey('order-1', 2));
    assertPaymentCode(() => buildPaymentIdempotencyKey('order-1', 0), 'invalid-amount');
  });
});

describe('maskCustomerPhone', () => {
  it('masks display numbers while preserving routability hints', () => {
    assert.equal(maskCustomerPhone('+254712345678'), '+254712***678');
    assert.equal(maskCustomerPhone(null), null);
    assert.equal(maskCustomerPhone(''), null);
    assert.equal(maskCustomerPhone('123'), '***');
  });
});
