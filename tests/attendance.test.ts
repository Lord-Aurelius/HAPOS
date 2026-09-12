import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  AttendanceError,
  assertAttendanceTransition,
  assertCheckoutOrder,
  assertValidEmployeeNumber,
  buildTerminalReference,
  formatWorkedDuration,
  generateTerminalToken,
  hashTerminalToken,
  merchantDateOf,
  normalizeEmployeeNumber,
  workedMinutes,
} from '../src/server/commerce/attendance.ts';

function assertAttendanceCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof AttendanceError && error.code === code,
    `expected AttendanceError ${code}`,
  );
}

describe('normalizeEmployeeNumber / assertValidEmployeeNumber', () => {
  it('normalises terminal input', () => {
    assert.equal(normalizeEmployeeNumber('  emp-0042 '), 'EMP-0042');
    assert.equal(normalizeEmployeeNumber(''), null);
    assert.equal(normalizeEmployeeNumber(null), null);
  });

  it('accepts well-formed numbers and rejects the rest', () => {
    assert.equal(assertValidEmployeeNumber('EMP-0042'), 'EMP-0042');
    assertCodeRejects();
    function assertCodeRejects() {
      assertAttendanceCode(() => assertValidEmployeeNumber(null), 'invalid-employee-number');
      assertAttendanceCode(() => assertValidEmployeeNumber('AB'), 'invalid-employee-number');
      assertAttendanceCode(() => assertValidEmployeeNumber('has spaces'), 'invalid-employee-number');
      assertAttendanceCode(() => assertValidEmployeeNumber('X'.repeat(17)), 'invalid-employee-number');
    }
  });
});

describe('assertAttendanceTransition', () => {
  it('allows check-in only with no open record', () => {
    assert.doesNotThrow(() => assertAttendanceTransition('CHECK_IN', null));
    assertAttendanceCode(() => assertAttendanceTransition('CHECK_IN', { id: 'open-1' }), 'already-checked-in');
  });

  it('allows check-out only with an open record', () => {
    assert.doesNotThrow(() => assertAttendanceTransition('CHECK_OUT', { id: 'open-1' }));
    assertAttendanceCode(() => assertAttendanceTransition('CHECK_OUT', null), 'not-checked-in');
  });

  it('rejects checkout earlier than check-in', () => {
    assert.doesNotThrow(() => assertCheckoutOrder('2026-05-01T05:00:00.000Z', '2026-05-01T14:00:00.000Z'));
    assertAttendanceCode(
      () => assertCheckoutOrder('2026-05-01T14:00:00.000Z', '2026-05-01T05:00:00.000Z'),
      'timestamp-violation',
    );
  });
});

describe('merchantDateOf (attendance-day semantics)', () => {
  it('uses the merchant-local calendar date, not UTC', () => {
    // 2026-05-01T02:30Z is still 30 April in New York.
    assert.equal(merchantDateOf('2026-05-01T02:30:00.000Z', 'America/New_York'), '2026-04-30');
    assert.equal(merchantDateOf('2026-05-01T02:30:00.000Z', 'Africa/Nairobi'), '2026-05-01');
  });

  it('falls back to UTC on unknown timezones instead of failing', () => {
    assert.equal(merchantDateOf('2026-05-01T02:30:00.000Z', 'Not/AZone'), '2026-05-01');
  });
});

describe('workedMinutes / formatWorkedDuration', () => {
  it('computes durations from absolute timestamps', () => {
    assert.equal(workedMinutes('2026-05-01T05:17:34.000Z', '2026-05-01T14:06:19.000Z'), 528);
    assert.equal(formatWorkedDuration('2026-05-01T05:17:34.000Z', '2026-05-01T14:06:19.000Z'), '8h 48m');
    assert.equal(formatWorkedDuration('2026-05-01T05:17:34.000Z', '2026-05-01T05:47:34.000Z'), '30m');
  });

  it('reports open records without fabricating an end', () => {
    assert.equal(workedMinutes('2026-05-01T05:17:34.000Z', null), null);
    assert.equal(formatWorkedDuration('2026-05-01T05:17:34.000Z', null), '—');
  });
});

describe('terminal credentials', () => {
  it('generates opaque tokens and stable hashes', () => {
    const token = generateTerminalToken('a1'.repeat(32));
    assert.equal(token.length, 64);
    assert.equal(hashTerminalToken(token), hashTerminalToken(token));
    assert.notEqual(hashTerminalToken(token), hashTerminalToken(`${token}0`));
    assert.equal(generateTerminalToken().length, 64);
  });

  it('builds URL-safe public references without secrets', () => {
    const reference = buildTerminalReference('Royal Fades', 'abcdef123456');
    assert.equal(reference, 'att-royal-fades-abcdef');
    assert.ok(!reference.includes(' ') && reference === reference.toLowerCase());
  });
});
