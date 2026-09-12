/**
 * Staff attendance domain engine (Phase 2A).
 *
 * Independent capability — no seller-QR, payment, ledger or AI dependency.
 * Vocabulary MUST match db/migrations/phase-2a-attendance.sql
 * (guarded by scripts/verify-phase-migrations.js).
 *
 * Rules:
 * - identity = existing employee (users.id); the employee NUMBER is the
 *   terminal input and is snapshotted onto each record for readability.
 * - timestamps are server-authoritative UTC; attendance_date is the
 *   merchant-local calendar date (browser timezones never decide the day).
 * - one open record per employee per tenant (partial-unique in SQL +
 *   application checks in the write transaction).
 *
 * Depends only on node:crypto (test-safe) — runs under `node --test`.
 */

import { createHash, randomBytes } from 'node:crypto';

export type AttendanceStatus = 'CHECKED_IN' | 'CHECKED_OUT';

export type AttendanceErrorCode =
  | 'invalid-employee-number'
  | 'unknown-employee'
  | 'inactive-employee'
  | 'cross-tenant'
  | 'already-checked-in'
  | 'not-checked-in'
  | 'invalid-terminal'
  | 'terminal-revoked'
  | 'invalid-transition'
  | 'timestamp-violation';

export class AttendanceError extends Error {
  readonly code: AttendanceErrorCode;

  constructor(code: AttendanceErrorCode, message: string) {
    super(message);
    this.name = 'AttendanceError';
    this.code = code;
  }
}

// ── Employee number ──────────────────────────────────────────────────────────

const EMPLOYEE_NUMBER_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,15}$/;

/** Normalize terminal input. Empty resolves to null (caller rejects). */
export function normalizeEmployeeNumber(raw: unknown): string | null {
  const text = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return text ? text : null;
}

/** Validate a normalized employee number for storage/lookup. */
export function assertValidEmployeeNumber(normalized: string | null): string {
  if (!normalized || !EMPLOYEE_NUMBER_PATTERN.test(normalized)) {
    throw new AttendanceError(
      'invalid-employee-number',
      'Enter a valid employee number (letters, numbers and hyphens, 3–16 characters).',
    );
  }
  return normalized;
}

// ── State machine ────────────────────────────────────────────────────────────

export type AttendanceTransition = 'CHECK_IN' | 'CHECK_OUT';

/**
 * Validate a transition against current state. `openRecord` is the existing
 * open record for the employee (or null). Throws on every illegal move —
 * there are no PATCH-style status writes.
 */
export function assertAttendanceTransition(
  action: AttendanceTransition,
  openRecord: { id: string } | null,
): void {
  if (action === 'CHECK_IN' && openRecord) {
    throw new AttendanceError(
      'already-checked-in',
      'This employee is already checked in. Check out first.',
    );
  }
  if (action === 'CHECK_OUT' && !openRecord) {
    throw new AttendanceError(
      'not-checked-in',
      'This employee is not checked in. Check in first.',
    );
  }
}

/** Server-side guard: checkout can never precede check-in. */
export function assertCheckoutOrder(checkInAt: string, checkOutAt: string): void {
  if (Date.parse(checkOutAt) < Date.parse(checkInAt)) {
    throw new AttendanceError(
      'timestamp-violation',
      'Check-out cannot be earlier than check-in.',
    );
  }
}

// ── Attendance-day semantics ─────────────────────────────────────────────────
// attendance_date = merchant-local calendar date at check-in. Timestamps stay
// absolute (UTC internally). Overnight shifts keep the check-in day.

export function merchantDateOf(timestampISO: string, timeZone: string): string {
  const date = new Date(timestampISO);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const lookup: Record<string, string> = {};
    for (const part of parts) {
      lookup[part.type] = part.value;
    }
    return `${lookup.year}-${lookup.month}-${lookup.day}`;
  } catch {
    // Unknown timezone configuration: fall back to the UTC date rather than
    // failing the check-in. Tenant timezones are validated at the admin
    // surface; this path should not normally trigger.
    return date.toISOString().slice(0, 10);
  }
}

// ── Duration ─────────────────────────────────────────────────────────────────

export function workedMinutes(checkInAt: string, checkOutAt: string | null | undefined, nowISO?: string): number | null {
  const end = checkOutAt ?? nowISO ?? null;
  if (!end) {
    return null;
  }
  const minutes = Math.floor((Date.parse(end) - Date.parse(checkInAt)) / 60000);
  return minutes >= 0 ? minutes : 0;
}

export function formatWorkedDuration(checkInAt: string, checkOutAt: string | null | undefined, nowISO?: string): string {
  const minutes = workedMinutes(checkInAt, checkOutAt, nowISO);
  if (minutes === null) {
    return '—';
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) {
    return `${remainder}m`;
  }
  return `${hours}h ${remainder}m`;
}

// ── Terminal credentials ─────────────────────────────────────────────────────
// The QR carries the public reference only. The token is an opaque,
// revocable, single-purpose terminal secret: it authenticates the TERMINAL
// context, never an employee, and is stored hashed.

export function generateTerminalToken(randomHex?: string): string {
  if (randomHex) {
    const cleaned = randomHex.replace(/[^a-f0-9]/gi, '').toLowerCase();
    if (cleaned.length >= 32) {
      return cleaned.slice(0, 64);
    }
  }
  return randomBytes(32).toString('hex');
}

export function hashTerminalToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function buildTerminalReference(shopSlug: string, randomHex?: string): string {
  const slug = shopSlug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'shop';
  const suffixSource = (randomHex ?? randomBytes(3).toString('hex')).replace(/[^a-f0-9]/gi, '').toLowerCase();
  const suffix = (suffixSource + '000000').slice(0, 6);
  return `att-${slug}-${suffix}`;
}
