/**
 * Payment domain engine (Phase 4).
 *
 * SALE ≠ PAYMENT: a sale records WHAT was sold; a payment records HOW money
 * moved. Nothing here marks money received because a button was clicked —
 * SUCCESS arrives only from provider confirmation (or cash completion).
 *
 * Vocabulary MUST match db/migrations/phase-04-payments.sql
 * (guarded by scripts/verify-phase-migrations.js).
 *
 * Dependency-free: runs under `node --test`.
 */

export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'CANCELLED';

export type PaymentProvider = 'PAYMENTOS' | 'INTERNAL';

export type PaymentMethod = 'CASH' | 'MPESA';

export type PaymentErrorCode =
  | 'invalid-transition'
  | 'invalid-amount'
  | 'amount-mismatch'
  | 'invalid-phone'
  | 'unknown-payment'
  | 'duplicate-payment'
  | 'payment-expired';

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;

  constructor(code: PaymentErrorCode, message: string) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
  }
}

const LEGAL_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED'],
  SUCCESS: [],
  FAILED: [],
  EXPIRED: [],
  CANCELLED: [],
};

/** Domain transitions only — SUCCESS is terminal and never reverts. */
export function transitionPaymentStatus(current: PaymentStatus, next: PaymentStatus): PaymentStatus {
  if (!LEGAL_TRANSITIONS[current].includes(next)) {
    throw new PaymentError(
      'invalid-transition',
      `Payment cannot move from ${current} to ${next}.`,
    );
  }
  return next;
}

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return status !== 'PENDING';
}

export type PaymentAmountInput = {
  /** Authoritative server-computed total (order/sale). */
  authoritativeTotal: number;
  /** Amount the provider reports (callback/verification). */
  reportedTotal?: number | null;
  currency: string;
  reportedCurrency?: string | null;
};

function assertValidMoney(amount: number, field: string): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new PaymentError('invalid-amount', `${field} must be a valid amount of zero or more.`);
  }
}

/**
 * Validate a payment amount at initiation: positive, finite, server-owned.
 * The browser never dictates the charge amount.
 */
export function assertInitiationAmount(authoritativeTotal: number): number {
  assertValidMoney(authoritativeTotal, 'Payment amount');
  if (authoritativeTotal <= 0) {
    throw new PaymentError('invalid-amount', 'Payment amount must be greater than zero.');
  }
  return authoritativeTotal;
}

/**
 * Validate provider confirmation against the authoritative HAPOS amount.
 * Any mismatch (amount, currency, context) is an explicit exception — the
 * sale must NOT finalize.
 */
export function assertConfirmationAmount(input: PaymentAmountInput): void {
  assertValidMoney(input.authoritativeTotal, 'Order total');
  if (input.reportedTotal === null || input.reportedTotal === undefined) {
    throw new PaymentError('amount-mismatch', 'Provider confirmation carries no amount.');
  }
  assertValidMoney(input.reportedTotal, 'Reported amount');
  if (Math.abs(input.reportedTotal - input.authoritativeTotal) > 0.005) {
    throw new PaymentError(
      'amount-mismatch',
      `Provider reported ${input.reportedTotal} but HAPOS expects ${input.authoritativeTotal}. Sale held for review.`,
    );
  }
  if (input.reportedCurrency && input.reportedCurrency !== input.currency) {
    throw new PaymentError(
      'amount-mismatch',
      `Provider currency ${input.reportedCurrency} does not match ${input.currency}. Sale held for review.`,
    );
  }
}

/** Expiry evaluation against the server clock (callers decide the sweep). */
export function isPaymentExpired(expiresAt: string | null | undefined, nowISO: string): boolean {
  if (!expiresAt) {
    return false;
  }
  return Date.parse(expiresAt) <= Date.parse(nowISO);
}

/**
 * Deterministic idempotency keys: one per attempt, stable across retries.
 * `attempt` starts at 1; retries reuse the key, new attempts increment it.
 */
export function buildPaymentIdempotencyKey(orderId: string, attempt: number): string {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new PaymentError('invalid-amount', 'Payment attempt must be a positive whole number.');
  }
  return `pay-${orderId}-${attempt}`;
}

/**
 * Mask an E.164 phone for display (`+254712345678` → `+254712***678`).
 * Full numbers never leave the store boundary except inside server-side
 * provider calls. Lists, receipts and admin views show the masked form.
 */
export function maskCustomerPhone(phone: string | null | undefined): string | null {
  if (!phone) {
    return null;
  }
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) {
    return '***';
  }
  return `+${digits.slice(0, 6)}***${digits.slice(-3)}`;
}
