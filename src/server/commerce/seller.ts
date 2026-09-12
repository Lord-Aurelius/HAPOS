/**
 * Seller credential domain (Phase 3).
 *
 * Deliberately SEPARATE from the attendance terminal implementation
 * (`attendance.ts` / `attendance-store.ts`): different credential, different
 * scope, different lifecycle. Shared primitive: sha256 token hashing (each
 * module owns its own helpers so neither QR system can drift into the other).
 *
 * Vocabulary MUST match db/migrations/phase-03-seller-credentials.sql
 * (guarded by scripts/verify-phase-migrations.js).
 *
 * Credential model:
 * - identity = existing users.id (staff/shop_admin). No new identity type.
 * - QR payload = `/sell/{publicReference}?k={bearer}`; bearer shown once.
 * - scope = CREATE_ORDER + SUBMIT_ORDER only. The context can never read
 *   history, admin data, inventory, attendance, ledger, or credentials.
 * - rotation and revocation affect future use; historical transactions stay
 *   valid (they reference seller_id, never the credential).
 */

import { createHash, randomBytes } from 'node:crypto';

export type SellerCredentialStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';

export type SellerOperation = 'CREATE_ORDER' | 'SUBMIT_ORDER';

export const SELLER_ALLOWED_OPERATIONS: ReadonlySet<SellerOperation> = new Set([
  'CREATE_ORDER',
  'SUBMIT_ORDER',
]);

export type SellerErrorCode =
  | 'invalid-reference'
  | 'invalid-bearer'
  | 'credential-revoked'
  | 'credential-expired'
  | 'credential-active'
  | 'unknown-seller'
  | 'inactive-seller'
  | 'cross-tenant'
  | 'forbidden-operation';

export class SellerError extends Error {
  readonly code: SellerErrorCode;

  constructor(code: SellerErrorCode, message: string) {
    super(message);
    this.name = 'SellerError';
    this.code = code;
  }
}

const REFERENCE_PATTERN = /^sel-[a-z0-9]{16}$/;

export function generateSellerBearer(randomHex?: string): string {
  if (randomHex) {
    const cleaned = randomHex.replace(/[^a-f0-9]/gi, '').toLowerCase();
    if (cleaned.length >= 32) {
      return cleaned.slice(0, 64);
    }
  }
  return randomBytes(32).toString('hex');
}

export function hashSellerBearer(bearer: string): string {
  return createHash('sha256').update(bearer, 'utf8').digest('hex');
}

export function buildSellerReference(randomHex?: string): string {
  const source = (randomHex ?? randomBytes(8).toString('hex')).replace(/[^a-f0-9]/gi, '').toLowerCase();
  return `sel-${(source + '0'.repeat(16)).slice(0, 16)}`;
}

export function assertValidSellerReference(reference: unknown): string {
  const text = typeof reference === 'string' ? reference.trim() : '';
  if (!REFERENCE_PATTERN.test(text)) {
    throw new SellerError('invalid-reference', 'This seller QR code is not recognized.');
  }
  return text;
}

/** QR contexts may only perform transaction-intent operations. */
export function assertSellerOperationAllowed(operation: string): SellerOperation {
  if (operation !== 'CREATE_ORDER' && operation !== 'SUBMIT_ORDER') {
    throw new SellerError(
      'forbidden-operation',
      'This seller context cannot perform that operation.',
    );
  }
  return operation;
}

/** Bearer expiry check. Null expiry means no expiry (persistent QR). */
export function assertCredentialFresh(expiresAt: string | null | undefined, nowISO: string): void {
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(nowISO)) {
    throw new SellerError('credential-expired', 'This seller QR code has expired. Ask an admin for a new one.');
  }
}
