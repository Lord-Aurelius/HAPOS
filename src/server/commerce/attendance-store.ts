/**
 * Attendance persistence operations (Phase 2A, unit 4).
 *
 * All functions run INSIDE one `updateStore` mutator (file projection) or one
 * relational transaction (future SQL adapter, guarded by the partial-unique
 * open-record index). Server timestamps only — client input never decides
 * check_in_at / check_out_at. Tokens are verified by hash; plaintext tokens
 * exist only as function results for one-time display.
 *
 * Operates on minimal structural store types: runs under `node --test`.
 */

import { randomUUID } from 'node:crypto';

import {
  AttendanceError,
  assertAttendanceTransition,
  assertCheckoutOrder,
  assertValidEmployeeNumber,
  buildTerminalReference,
  generateTerminalToken,
  hashTerminalToken,
  merchantDateOf,
  normalizeEmployeeNumber,
} from './attendance.ts';

export type AttendanceUser = {
  id: string;
  tenantId: string | null;
  fullName: string;
  employeeNumber?: string | null;
  isActive: boolean;
};

export type AttendanceTerminalRow = {
  id: string;
  tenantId: string;
  reference: string;
  tokenHash: string;
  isActive: boolean;
  revokedAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceRecordRow = {
  id: string;
  tenantId: string;
  employeeId: string;
  employeeNumberSnapshot: string;
  attendanceDate: string;
  checkInAt: string;
  checkOutAt?: string | null;
  status: string;
  terminalReference?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AttendanceStore = {
  users: AttendanceUser[];
  attendanceTerminals: AttendanceTerminalRow[];
  attendanceRecords: AttendanceRecordRow[];
};

export type AttendanceContext = {
  now?: string;
  generateId?: () => string;
  tokenHex?: string;
};

function contextNow(ctx: AttendanceContext): string {
  return ctx.now ?? new Date().toISOString();
}

function contextId(ctx: AttendanceContext): string {
  return (ctx.generateId ?? randomUUID)();
}

// ── Terminal context ─────────────────────────────────────────────────────────

/** Resolve a public terminal reference to its tenant. Never exposes the hash. */
export function resolveTerminalContext(
  store: AttendanceStore,
  reference: string,
): { tenantId: string; reference: string } {
  const terminal = store.attendanceTerminals.find((item) => item.reference === reference) ?? null;
  if (!terminal) {
    throw new AttendanceError('invalid-terminal', 'This attendance terminal is not recognized.');
  }
  if (!terminal.isActive || terminal.revokedAt) {
    throw new AttendanceError('terminal-revoked', 'This attendance terminal has been revoked.');
  }
  return { tenantId: terminal.tenantId, reference: terminal.reference };
}

/** Verify a presented terminal token against the stored hash. */
export function verifyTerminalToken(
  store: AttendanceStore,
  reference: string,
  token: string,
): { tenantId: string; reference: string } {
  const context = resolveTerminalContext(store, reference);
  const terminal = store.attendanceTerminals.find((item) => item.reference === reference) ?? null;
  if (!terminal || terminal.tokenHash !== hashTerminalToken(token)) {
    throw new AttendanceError('invalid-terminal', 'This attendance terminal is not recognized.');
  }
  return context;
}

// ── Employee identification (terminal step 1: resolve + confirm) ─────────────

export type IdentifiedEmployee = {
  id: string;
  fullName: string;
  employeeNumber: string;
  isActive: boolean;
  openRecordId: string | null;
  openCheckInAt: string | null;
};

/**
 * Resolve an employee number within the tenant for identity confirmation.
 * Returns minimal display data (name, number, current state) — never
 * credentials, sessions, or unrelated profile fields.
 */
export function identifyEmployee(
  store: AttendanceStore,
  tenantId: string,
  employeeNumberRaw: unknown,
): IdentifiedEmployee {
  const normalized = assertValidEmployeeNumber(normalizeEmployeeNumber(employeeNumberRaw));
  const user = store.users.find(
    (item) => item.tenantId === tenantId && (item.employeeNumber ?? '').toUpperCase() === normalized,
  ) ?? null;
  if (!user) {
    throw new AttendanceError('unknown-employee', 'No employee with that number in this shop.');
  }
  if (!user.isActive) {
    throw new AttendanceError('inactive-employee', 'That employee record is inactive. Ask an admin for help.');
  }
  const open = store.attendanceRecords.find(
    (item) => item.tenantId === tenantId && item.employeeId === user.id && !item.checkOutAt,
  ) ?? null;
  return {
    id: user.id,
    fullName: user.fullName,
    employeeNumber: normalized,
    isActive: user.isActive,
    openRecordId: open?.id ?? null,
    openCheckInAt: open?.checkInAt ?? null,
  };
}

// ── Check-in / check-out (terminal step 2: confirmed action) ─────────────────

export type AttendanceActionInput = {
  tenantId: string;
  employeeNumber: string;
  terminalReference?: string | null;
  timeZone: string;
};

function requireActiveTerminal(store: AttendanceStore, terminalReference: string | null | undefined): string | null {
  if (!terminalReference) {
    return null;
  }
  return resolveTerminalContext(store, terminalReference).reference;
}

/**
 * Record check-in. Revalidates everything server-side: the displayed state
 * may be stale (double-click, retry, concurrent terminal), so the open-record
 * claim happens here, atomically with the insert in the caller's transaction.
 */
export function checkInEmployee(
  store: AttendanceStore,
  input: AttendanceActionInput,
  ctx: AttendanceContext = {},
): AttendanceRecordRow {
  const terminalReference = requireActiveTerminal(store, input.terminalReference);
  const identified = identifyEmployee(store, input.tenantId, input.employeeNumber);
  const open = store.attendanceRecords.find(
    (item) => item.tenantId === input.tenantId && item.employeeId === identified.id && !item.checkOutAt,
  ) ?? null;
  // Domain transition first (friendly error), then the structural claim.
  assertAttendanceTransition('CHECK_IN', open ? { id: open.id } : null);
  if (open) {
    // Concurrent winner already inserted between identify and claim.
    throw new AttendanceError('already-checked-in', 'This employee is already checked in. Check out first.');
  }

  const now = contextNow(ctx);
  const record: AttendanceRecordRow = {
    id: contextId(ctx),
    tenantId: input.tenantId,
    employeeId: identified.id,
    employeeNumberSnapshot: identified.employeeNumber,
    attendanceDate: merchantDateOf(now, input.timeZone),
    checkInAt: now,
    checkOutAt: null,
    status: 'CHECKED_IN',
    terminalReference,
    createdAt: now,
    updatedAt: now,
  };
  store.attendanceRecords.push(record);
  return record;
}

export function checkOutEmployee(
  store: AttendanceStore,
  input: AttendanceActionInput,
  ctx: AttendanceContext = {},
): AttendanceRecordRow {
  const terminalReference = requireActiveTerminal(store, input.terminalReference);
  const identified = identifyEmployee(store, input.tenantId, input.employeeNumber);
  const open = store.attendanceRecords.find(
    (item) => item.tenantId === input.tenantId && item.employeeId === identified.id && !item.checkOutAt,
  ) ?? null;
  assertAttendanceTransition('CHECK_OUT', open ? { id: open.id } : null);
  if (!open) {
    // Lost race with a concurrent checkout or never checked in.
    throw new AttendanceError('not-checked-in', 'This employee is not checked in. Check in first.');
  }

  const now = contextNow(ctx);
  assertCheckoutOrder(open.checkInAt, now);
  open.checkOutAt = now;
  open.status = 'CHECKED_OUT';
  open.updatedAt = now;
  if (terminalReference && !open.terminalReference) {
    open.terminalReference = terminalReference;
  }
  return open;
}

// ── Terminal administration ──────────────────────────────────────────────────

export type RotatedTerminal = {
  terminal: AttendanceTerminalRow;
  /** Plaintext token for ONE-TIME display (QR render). Never persisted. */
  token: string;
};

/** Rotate (or first-activate) a tenant terminal. Old tokens stop working. */
export function rotateTerminal(
  store: AttendanceStore,
  input: { tenantId: string; createdBy?: string | null; shopSlug: string },
  ctx: AttendanceContext = {},
): RotatedTerminal {
  const now = contextNow(ctx);
  const token = generateTerminalToken(ctx.tokenHex);
  let terminal = store.attendanceTerminals.find((item) => item.tenantId === input.tenantId) ?? null;
  if (!terminal) {
    terminal = {
      id: contextId(ctx),
      tenantId: input.tenantId,
      reference: buildTerminalReference(input.shopSlug, ctx.tokenHex),
      tokenHash: hashTerminalToken(token),
      isActive: true,
      revokedAt: null,
      createdBy: input.createdBy ?? null,
      createdAt: now,
      updatedAt: now,
    };
    store.attendanceTerminals.push(terminal);
    return { terminal, token };
  }

  terminal.tokenHash = hashTerminalToken(token);
  terminal.isActive = true;
  terminal.revokedAt = null;
  terminal.updatedAt = now;
  return { terminal, token };
}

/** Revoke a terminal (QR stops resolving). Rotation re-activates. */
export function setTerminalActive(
  store: AttendanceStore,
  input: { tenantId: string; isActive: boolean },
  ctx: AttendanceContext = {},
): AttendanceTerminalRow {
  const terminal = store.attendanceTerminals.find((item) => item.tenantId === input.tenantId) ?? null;
  if (!terminal) {
    throw new AttendanceError('invalid-terminal', 'This shop has no attendance terminal yet.');
  }
  const now = contextNow(ctx);
  terminal.isActive = input.isActive;
  terminal.revokedAt = input.isActive ? null : now;
  terminal.updatedAt = now;
  return terminal;
}
