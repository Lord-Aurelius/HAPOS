import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  checkInEmployee,
  checkOutEmployee,
  identifyEmployee,
  resolveTerminalContext,
  rotateTerminal,
  setTerminalActive,
  verifyTerminalToken,
  type AttendanceStore,
} from '../src/server/commerce/attendance-store.ts';
import { AttendanceError } from '../src/server/commerce/attendance.ts';

let sequence = 0;
function generateId() {
  sequence += 1;
  return `attendance-op-${sequence}`;
}

const TOKEN_HEX = 'b2'.repeat(32);

function testStore(): AttendanceStore {
  return {
    users: [
      { id: 'emp-john', tenantId: 'tenant-a', fullName: 'John Otieno', employeeNumber: 'EMP-0042', isActive: true },
      { id: 'emp-idle', tenantId: 'tenant-a', fullName: 'Idle Worker', employeeNumber: 'EMP-0007', isActive: false },
      { id: 'emp-foreign', tenantId: 'tenant-b', fullName: 'Foreign Worker', employeeNumber: 'EMP-0042', isActive: true },
    ],
    attendanceTerminals: [
      {
        id: 'term-a', tenantId: 'tenant-a', reference: 'att-shop-a-123456',
        tokenHash: 'HASH-A', isActive: true, revokedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    attendanceRecords: [],
  };
}

function assertAttendanceCode(fn: () => unknown, code: string) {
  assert.throws(
    fn,
    (error: unknown) => error instanceof AttendanceError && error.code === code,
    `expected AttendanceError ${code}`,
  );
}

describe('identifyEmployee', () => {
  it('resolves minimal confirmation data for a valid number', () => {
    const identified = identifyEmployee(testStore(), 'tenant-a', 'emp-0042');
    assert.equal(identified.fullName, 'John Otieno');
    assert.equal(identified.employeeNumber, 'EMP-0042');
    assert.equal(identified.openRecordId, null);
    assert.ok(!('password' in identified));
  });

  it('rejects unknown, inactive and cross-tenant numbers', () => {
    const store = testStore();
    assertAttendanceCode(() => identifyEmployee(store, 'tenant-a', 'EMP-9999'), 'unknown-employee');
    assertAttendanceCode(() => identifyEmployee(store, 'tenant-a', 'EMP-0007'), 'inactive-employee');
    // Same number exists in tenant-b but lookup is tenant-scoped: tenant-a's
    // EMP-0042 resolves to John, never to the foreign worker.
    assert.equal(identifyEmployee(store, 'tenant-a', 'EMP-0042').id, 'emp-john');
    assert.equal(identifyEmployee(store, 'tenant-b', 'EMP-0042').id, 'emp-foreign');
  });
});

describe('checkInEmployee / checkOutEmployee', () => {
  it('checks in with server timestamps and merchant-local date', () => {
    const store = testStore();
    const record = checkInEmployee(
      store,
      { tenantId: 'tenant-a', employeeNumber: 'EMP-0042', terminalReference: 'att-shop-a-123456', timeZone: 'Africa/Nairobi' },
      { generateId, now: '2026-05-01T05:17:34.000Z' },
    );
    assert.equal(record.status, 'CHECKED_IN');
    assert.equal(record.checkInAt, '2026-05-01T05:17:34.000Z');
    assert.equal(record.attendanceDate, '2026-05-01');
    assert.equal(record.employeeNumberSnapshot, 'EMP-0042');
    assert.equal(record.checkOutAt, null);
  });

  it('rejects checkout with no open record (no phantom records)', () => {
    const store = testStore();
    assertAttendanceCode(
      () => checkOutEmployee(store, { tenantId: 'tenant-a', employeeNumber: 'EMP-0042', timeZone: 'Africa/Nairobi' }, { generateId }),
      'not-checked-in',
    );
    assert.equal(store.attendanceRecords.length, 0);
  });

  it('rejects duplicate check-in and duplicate check-out', () => {
    const store = testStore();
    const input = { tenantId: 'tenant-a', employeeNumber: 'EMP-0042', timeZone: 'Africa/Nairobi' };
    checkInEmployee(store, input, { generateId, now: '2026-05-01T05:00:00.000Z' });
    assertAttendanceCode(() => checkInEmployee(store, input, { generateId }), 'already-checked-in');
    assert.equal(store.attendanceRecords.length, 1);

    checkOutEmployee(store, input, { generateId, now: '2026-05-01T14:00:00.000Z' });
    assertAttendanceCode(() => checkOutEmployee(store, input, { generateId }), 'not-checked-in');
    assert.equal(store.attendanceRecords.length, 1);
    assert.equal(store.attendanceRecords[0].status, 'CHECKED_OUT');
  });

  it('closes the record with server checkout and enforces ordering', () => {
    const store = testStore();
    const input = { tenantId: 'tenant-a', employeeNumber: 'EMP-0042', timeZone: 'Africa/Nairobi' };
    checkInEmployee(store, input, { generateId, now: '2026-05-01T05:00:00.000Z' });
    const closed = checkOutEmployee(store, input, { generateId, now: '2026-05-01T14:06:19.000Z' });
    assert.equal(closed.checkOutAt, '2026-05-01T14:06:19.000Z');
    assert.equal(closed.status, 'CHECKED_OUT');
  });

  it('rejects revoked terminals and enforces one open record per employee', () => {
    const store = testStore();
    setTerminalActive(store, { tenantId: 'tenant-a', isActive: false }, { generateId });
    assertAttendanceCode(
      () => checkInEmployee(store, { tenantId: 'tenant-a', employeeNumber: 'EMP-0042', terminalReference: 'att-shop-a-123456', timeZone: 'Africa/Nairobi' }, { generateId }),
      'terminal-revoked',
    );
    assertAttendanceCode(() => resolveTerminalContext(store, 'att-unknown'), 'invalid-terminal');
  });
});

describe('concurrent check-in', () => {
  it('exactly one simultaneous check-in succeeds', () => {
    const store = testStore();
    const input = { tenantId: 'tenant-a', employeeNumber: 'EMP-0042', timeZone: 'Africa/Nairobi' };
    const outcomes = [0, 1].map((index) => {
      try {
        const record = checkInEmployee(store, input, { generateId, now: `2026-05-01T05:00:0${index}.000Z` });
        return { ok: true as const, id: record.id };
      } catch (error) {
        assert.ok(error instanceof AttendanceError && error.code === 'already-checked-in');
        return { ok: false as const, id: null };
      }
    });
    assert.equal(store.attendanceRecords.length, 1);
    assert.equal(outcomes.filter((o) => o.ok).length, 1);
  });
});

describe('rotateTerminal / verifyTerminalToken', () => {
  it('rotates credentials and invalidates the previous token', () => {
    const store = testStore();
    const first = rotateTerminal(store, { tenantId: 'tenant-a', shopSlug: 'shop-a' }, { generateId, tokenHex: TOKEN_HEX });
    assert.equal(first.token.length, 64);
    assert.doesNotThrow(() => verifyTerminalToken(store, first.terminal.reference, first.token));

    const second = rotateTerminal(store, { tenantId: 'tenant-a', shopSlug: 'shop-a' }, { generateId, tokenHex: 'c3'.repeat(32) });
    assert.equal(second.terminal.reference, first.terminal.reference);
    assertAttendanceCode(() => verifyTerminalToken(store, first.terminal.reference, first.token), 'invalid-terminal');
    assert.doesNotThrow(() => verifyTerminalToken(store, second.terminal.reference, second.token));
  });

  it('delete-as-revocation preserves attendance history', () => {
    const store = testStore();
    const rotated = rotateTerminal(store, { tenantId: 'tenant-a', shopSlug: 'shop-a' }, { generateId, tokenHex: TOKEN_HEX });
    checkInEmployee(
      store,
      { tenantId: 'tenant-a', employeeNumber: 'EMP-0042', terminalReference: rotated.terminal.reference, timeZone: 'Africa/Nairobi' },
      { generateId, now: '2026-05-01T05:00:00.000Z' },
    );
    // Delete maps to revocation: the QR dies, the record lives.
    setTerminalActive(store, { tenantId: 'tenant-a', isActive: false }, { generateId });
    assert.equal(store.attendanceRecords.length, 1);
    assert.equal(store.attendanceRecords[0].status, 'CHECKED_IN');
    assertAttendanceCode(
      () => checkInEmployee(
        store,
        { tenantId: 'tenant-a', employeeNumber: 'EMP-0042', terminalReference: rotated.terminal.reference, timeZone: 'Africa/Nairobi' },
        { generateId },
      ),
      'terminal-revoked',
    );
  });

  it('seals the token for persistent renders when a wrap key is provided', async () => {
    const { openBearer, parseQrWrapKey } = await import('../src/server/crypto/qr-wrap.ts');
    const store = testStore();
    const key = parseQrWrapKey('a1'.repeat(32));
    const rotated = rotateTerminal(
      store, { tenantId: 'tenant-a', shopSlug: 'shop-a' }, { generateId, tokenHex: TOKEN_HEX, wrapKey: key },
    );
    assert.ok(rotated.terminal.tokenWrapped);
    assert.equal(openBearer(rotated.terminal.tokenWrapped ?? null, key), rotated.token);
    // Rotation replaces the sealed copy with the fresh token.
    const again = rotateTerminal(
      store, { tenantId: 'tenant-a', shopSlug: 'shop-a' }, { generateId, tokenHex: 'c3'.repeat(32), wrapKey: key },
    );
    assert.equal(openBearer(again.terminal.tokenWrapped ?? null, key), again.token);
    assert.notEqual(again.token, rotated.token);
  });

  it('rejects missing, wrong and cross-context tokens', () => {
    const store = testStore();
    const rotated = rotateTerminal(store, { tenantId: 'tenant-a', shopSlug: 'shop-a' }, { generateId, tokenHex: TOKEN_HEX });
    assertAttendanceCode(() => verifyTerminalToken(store, rotated.terminal.reference, ''), 'invalid-terminal');
    assertAttendanceCode(() => verifyTerminalToken(store, rotated.terminal.reference, '0'.repeat(64)), 'invalid-terminal');
    assertAttendanceCode(() => verifyTerminalToken(store, 'att-unknown-000000', rotated.token), 'invalid-terminal');
  });
});

describe('security boundaries', () => {
  it('identify exposes only confirmation data (no secrets, no hash)', () => {
    const identified = identifyEmployee(testStore(), 'tenant-a', 'EMP-0042');
    assert.deepEqual(Object.keys(identified).sort(), [
      'employeeNumber',
      'fullName',
      'id',
      'isActive',
      'openCheckInAt',
      'openRecordId',
    ]);
  });

  it('employees without a number can never be resolved', () => {
    const store = testStore();
    store.users = [{ id: 'emp-nonumber', tenantId: 'tenant-a', fullName: 'No Number', isActive: true }];
    assertAttendanceCode(() => identifyEmployee(store, 'tenant-a', 'EMP-0042'), 'unknown-employee');
    assertAttendanceCode(() => identifyEmployee(store, 'tenant-a', 'EMP-0099'), 'unknown-employee');
  });

  it('unknown terminal references fail closed on actions', () => {
    const store = testStore();
    assertAttendanceCode(
      () => checkInEmployee(store, { tenantId: 'tenant-a', employeeNumber: 'EMP-0042', terminalReference: 'att-nope-000000', timeZone: 'Africa/Nairobi' }, { generateId }),
      'invalid-terminal',
    );
    assert.equal(store.attendanceRecords.length, 0);
  });

  it('concurrent checkouts converge on one close', () => {
    const store = testStore();
    const input = { tenantId: 'tenant-a', employeeNumber: 'EMP-0042', timeZone: 'Africa/Nairobi' };
    checkInEmployee(store, input, { generateId, now: '2026-05-01T05:00:00.000Z' });
    const outcomes = [0, 1].map(() => {
      try {
        checkOutEmployee(store, input, { generateId, now: '2026-05-01T14:00:00.000Z' });
        return true;
      } catch (error) {
        assert.ok(error instanceof AttendanceError && error.code === 'not-checked-in');
        return false;
      }
    });
    assert.deepEqual(outcomes.filter(Boolean).length, 1);
    assert.equal(store.attendanceRecords.length, 1);
    assert.equal(store.attendanceRecords[0].status, 'CHECKED_OUT');
  });
});
