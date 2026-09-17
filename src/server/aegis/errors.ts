/**
 * AEGIS machine-readable error contract.
 *
 * Every capability invocation resolves to either `{ ok: true, data }` or
 * `{ ok: false, error: { code, message, retryable } }` so the planner can
 * distinguish retry / ask-user / stop without parsing message strings.
 * Runs under `node --test` (dependency-free).
 */

export type AiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'WRONG_TENANT'
  | 'WRONG_SHOP'
  | 'CONFLICT'
  | 'ALREADY_COMPLETED'
  | 'CONFIRMATION_REQUIRED'
  | 'RATE_LIMITED'
  | 'TEMPORARY_FAILURE'
  | 'INTERNAL_ERROR';

export type AiErrorBody = {
  code: AiErrorCode;
  message: string;
  retryable: boolean;
};

const STATUS_BY_CODE: Record<AiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INVALID_ARGUMENT: 400,
  NOT_FOUND: 404,
  WRONG_TENANT: 403,
  WRONG_SHOP: 403,
  CONFLICT: 409,
  ALREADY_COMPLETED: 409,
  CONFIRMATION_REQUIRED: 428,
  RATE_LIMITED: 429,
  TEMPORARY_FAILURE: 503,
  INTERNAL_ERROR: 500,
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: AiErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.retryable = retryable;
    this.status = STATUS_BY_CODE[code];
  }

  toBody(): AiErrorBody {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

type CodedError = { code?: unknown; message?: unknown };

function domainCodeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const code = (error as CodedError).code;
  return typeof code === 'string' ? code : null;
}

/**
 * Map HAPOS domain errors to the machine contract. Unknown errors become
 * INTERNAL_ERROR without leaking internals (message is sanitized).
 */
export function toAiError(error: unknown): AiError {
  if (error instanceof AiError) {
    return error;
  }
  switch (domainCodeOf(error)) {
    case 'not-permitted':
      return new AiError('FORBIDDEN', 'That operation is not permitted for this principal.', false);
    case 'unknown-item':
    case 'invalid-reference':
    case 'invalid-bearer':
    case 'unknown-payment':
    case 'unknown-seller':
    case 'approval-missing':
      return new AiError('NOT_FOUND', 'The requested record was not found for this shop.', false);
    case 'cross-tenant-item':
      return new AiError('WRONG_TENANT', 'That record belongs to another shop.', false);
    case 'credential-revoked':
    case 'credential-expired':
    case 'inactive-seller':
      return new AiError('FORBIDDEN', 'That credential is no longer usable. Ask an admin for a new one.', false);
    case 'already-approved':
      return new AiError('ALREADY_COMPLETED', 'That order was already approved.', false);
    case 'order-duplicate':
      return new AiError('ALREADY_COMPLETED', 'That submission was already recorded.', false);
    case 'invalid-transition':
    case 'already-voided':
    case 'insufficient-stock':
    case 'inactive-item':
    case 'needs-pricing':
    case 'credential-active':
      return new AiError('CONFLICT', errorMessage(error, 'That change is not allowed from the current state.'), false);
    case 'callback-unauthenticated':
      return new AiError('UNAUTHORIZED', 'The payment provider callback could not be authenticated.', false);
    case 'gateway-timeout':
      return new AiError('TEMPORARY_FAILURE', 'The payment provider did not respond. Retry shortly.', true);
    case 'gateway-rejected':
    case 'gateway-unconfigured':
    case 'mock-forbidden':
    case 'connection-not-connected':
    case 'connection-environment-mismatch':
    case 'connection-secret-unavailable':
      return new AiError('CONFLICT', errorMessage(error, 'Payment cannot proceed for this shop right now.'), false);
    case 'invalid-key':
    case 'wrap-unavailable':
    case 'needs-reissue':
      return new AiError('CONFLICT', errorMessage(error, 'That QR credential needs reissuing.'), false);
    case 'qr-not-found':
      return new AiError('NOT_FOUND', 'No active QR credential matches that reference.', false);
    case 'invalid-name':
    case 'invalid-scope':
    case 'missing-binding':
    case 'unknown-key':
      return mapApiKeyError(domainCodeOf(error) as string);
    default:
      break;
  }
  if (isValidationError(error)) {
    return new AiError('INVALID_ARGUMENT', errorMessage(error, 'Invalid argument.'), false);
  }
  return new AiError('INTERNAL_ERROR', 'The operation failed unexpectedly.', false);
}

function mapApiKeyError(code: string): AiError {
  switch (code) {
    case 'unknown-key':
      return new AiError('UNAUTHORIZED', 'Unknown or revoked API key.', false);
    case 'forbidden':
      return new AiError('FORBIDDEN', 'That key may not perform this operation.', false);
    case 'missing-binding':
      return new AiError('INVALID_ARGUMENT', 'That key request is missing its tenant or user binding.', false);
    default:
      return new AiError('INVALID_ARGUMENT', 'Invalid API key request.', false);
  }
}

const VALIDATION_NAMES = new Set([
  'SaleValidationError',
  'CartFormError',
  'IdempotencyKeyError',
  'TypeError',
]);

function isValidationError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const name = (error as { name?: unknown }).name;
  if (typeof name === 'string' && VALIDATION_NAMES.has(name)) {
    return true;
  }
  const code = domainCodeOf(error);
  return (
    code === 'empty-order' ||
    code === 'invalid-price' ||
    code === 'invalid-quantity' ||
    code === 'invalid-amount' ||
    code === 'invalid-phone' ||
    code === 'invalid-date' ||
    code === 'invalid-idempotency-key' ||
    code === 'override-reason-required' ||
    code === 'total-mismatch' ||
    code === 'unknown-product'
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) {
      return message;
    }
  }
  return fallback;
}
