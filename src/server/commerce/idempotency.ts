/**
 * Server-side sale idempotency (Phase 0.4).
 *
 * Contract:
 * ```
 * same idempotency key + same tenant + same sale intent = exactly one logical sale
 * ```
 *
 * The key is stored ON the service record (`idempotencyKey`). The
 * check-and-insert MUST run inside the `updateStore` mutator closure, which is
 * the only atomic section available in both persistence backends:
 * - postgres mode: `SELECT ... FOR UPDATE` on `app.runtime_state` serialises
 *   writers, so check-then-insert cannot interleave,
 * - file mode: the single-process `writeChain` serialises `updateStore` calls
 *   (dev/preview only — production must use postgres mode).
 *
 * This module is dependency-free and operates on minimal structural types so
 * the core claim logic is unit-testable under `node --test`. Server Actions
 * and API routes wire it into `updateStore`; the form pages submit one key
 * per render so browser double-click / network retry resubmits the same key.
 */

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export class IdempotencyKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyKeyError';
  }
}

/**
 * Normalise a client-supplied key. Empty/missing resolves to `null`
 * (caller generates a fresh key for one-off writes). Malformed keys throw —
 * silently accepting them would break the exactly-once contract.
 */
export function normalizeIdempotencyKey(raw: unknown): string | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    return null;
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(text)) {
    throw new IdempotencyKeyError(
      'idempotencyKey must be 8-128 characters of letters, numbers, hyphen or underscore.',
    );
  }
  return text;
}

export type IdempotentSaleRecord = {
  id: string;
  tenantId: string;
  idempotencyKey?: string | null;
};

/**
 * Look up a previously recorded sale for this tenant + key. Tenant scoping
 * is part of the lookup so keys can never collide across shops.
 */
export function findExistingSaleRecord<T extends IdempotentSaleRecord>(
  records: T[],
  tenantId: string,
  key: string | null,
): T | null {
  if (!key) {
    return null;
  }
  return records.find((record) => record.tenantId === tenantId && record.idempotencyKey === key) ?? null;
}

export type IdempotentSaleClaim<T> =
  | { duplicate: true; record: T }
  | { duplicate: false; record: null };

/**
 * Claim exactly-once creation inside an atomic mutator. Call BEFORE creating
 * the record; if `duplicate` is true, return the existing record instead of
 * inserting. `create` runs only when no prior claim exists.
 */
export function claimIdempotentSale<T extends IdempotentSaleRecord>(
  records: T[],
  tenantId: string,
  key: string | null,
  create: () => T,
): { record: T; duplicate: boolean } {
  const existing = findExistingSaleRecord(records, tenantId, key);
  if (existing) {
    return { record: existing, duplicate: true };
  }
  const record = create();
  return { record, duplicate: false };
}
