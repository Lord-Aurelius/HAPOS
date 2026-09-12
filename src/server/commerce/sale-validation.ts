/**
 * Typed input validation for sale / product / order write paths (Phase 0.3).
 *
 * Replaces two silent behaviours:
 * - `Number(undefined)` / `Number('abc')` producing `NaN` that was persisted,
 * - unknown `productId` values silently degrading to `productUsages: []`.
 *
 * Every invalid value throws a {@link SaleValidationError} carrying a stable
 * machine-readable `code` so Server Actions can redirect with an explicit
 * `?error=<code>` and API routes can return HTTP 400.
 *
 * Deliberately dependency-free so it runs under `node --test` without the
 * Next.js runtime.
 */

export type SaleValidationCode =
  | 'invalid-price'
  | 'invalid-amount'
  | 'invalid-quantity'
  | 'unknown-product'
  | 'missing-id'
  | 'missing-name'
  | 'invalid-date'
  | 'invalid-phone'
  | 'invalid-sku'
  | 'duplicate-sku'
  | 'invalid-threshold';

export class SaleValidationError extends Error {
  readonly code: SaleValidationCode;
  readonly field: string;

  constructor(code: SaleValidationCode, field: string, message: string) {
    super(message);
    this.name = 'SaleValidationError';
    this.code = code;
    this.field = field;
  }
}

function toTrimmedText(raw: unknown): string {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : '';
  }
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.trim();
}

/**
 * Parse a monetary value (price, unit cost, expense amount, commission value).
 * Empty / non-numeric / non-finite / negative values throw. Zero is allowed
 * (e.g. zero commission, zero product cost) — callers that need a positive
 * amount must check `> 0` themselves so custom-service rules stay explicit.
 */
export function parseMoneyInput(raw: unknown, field: string, code: SaleValidationCode = 'invalid-price'): number {
  const text = toTrimmedText(raw);
  if (!text) {
    throw new SaleValidationError(code, field, `${field} is required and must be a valid amount.`);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new SaleValidationError(code, field, `${field} must be a valid amount.`);
  }
  if (value < 0) {
    throw new SaleValidationError(code, field, `${field} cannot be negative.`);
  }
  return value;
}

/** Optional money: empty input resolves to `null` instead of throwing. */
export function parseOptionalMoneyInput(
  raw: unknown,
  field: string,
  code: SaleValidationCode = 'invalid-price',
): number | null {
  const text = toTrimmedText(raw);
  if (!text) {
    return null;
  }
  return parseMoneyInput(text, field, code);
}

/**
 * Parse a product quantity from form/API input.
 * Empty / missing input means "no product entered" and resolves to `0`
 * (preserves the service-entry default `productQuantity=1` + `productId=''`
 * behaviour). Otherwise the value must be a non-negative integer.
 */
export function parseProductQuantityInput(raw: unknown, field = 'productQuantity'): number {
  const text = toTrimmedText(raw);
  if (!text) {
    return 0;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new SaleValidationError('invalid-quantity', field, `${field} must be a whole number.`);
  }
  if (value < 0) {
    throw new SaleValidationError('invalid-quantity', field, `${field} cannot be negative.`);
  }
  return value;
}

/** Require a non-empty entity id (service, staff, customer, record, ...). */
export function requireEntityId(raw: unknown, field: string): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    throw new SaleValidationError('missing-id', field, `${field} is required.`);
  }
  return text;
}

/** Require a non-empty display name (service name, customer name, ...). */
export function requireDisplayName(raw: unknown, field: string): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) {
    throw new SaleValidationError('missing-name', field, `${field} is required.`);
  }
  return text;
}

export type ProductUsageInput = {
  productId: string;
  quantity: number;
  unitCost: number;
};

export type ProductCatalogEntry = {
  id: string;
  tenantId: string;
  unitCost: number;
};

/**
 * Resolve the single-product usage for a sale.
 *
 * Preserved behaviour: no product selected (`productId` empty) or zero
 * quantity resolves to `[]` — the service-entry form always submits
 * `productQuantity=1` alongside `productId=''`, which must stay a no-op.
 *
 * New explicit behaviour: a non-empty `productId` that does not belong to
 * the tenant throws `unknown-product` instead of silently dropping the line.
 */
export function resolveProductUsage(
  products: ProductCatalogEntry[],
  tenantId: string,
  productId: string | null | undefined,
  quantity: number,
): ProductUsageInput[] {
  if (!productId || quantity <= 0) {
    return [];
  }
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new SaleValidationError('invalid-quantity', 'productQuantity', 'productQuantity must be a whole number.');
  }
  const product = products.find((item) => item.id === productId && item.tenantId === tenantId);
  if (!product) {
    throw new SaleValidationError(
      'unknown-product',
      'productId',
      'The selected product is not available for this shop. Choose another product or record the sale without one.',
    );
  }
  return [{ productId: product.id, quantity, unitCost: product.unitCost }];
}

/** Expense dates must be explicit ISO calendar days (`YYYY-MM-DD`). */
export function parseExpenseDateInput(raw: unknown, field = 'expenseDate'): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new SaleValidationError('invalid-date', field, `${field} must be a valid date (YYYY-MM-DD).`);
  }
  const timestamp = Date.parse(`${text}T00:00:00.000Z`);
  if (Number.isNaN(timestamp)) {
    throw new SaleValidationError('invalid-date', field, `${field} must be a valid date (YYYY-MM-DD).`);
  }
  return text;
}

/**
 * Validate + normalize a Kenyan M-Pesa phone number to E.164 (`+254…`).
 * Accepts `07XXXXXXXX`, `254XXXXXXXXX`, `+254XXXXXXXXX` (mobile 7XX/1XX).
 * This is an input boundary for Phase 4 PaymentOS — no payment is created.
 */
export function parseKenyanPhoneInput(raw: unknown, field = 'customerPhone'): string {
  const digits = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
  let normalized = '';
  if (/^0[17]\d{8}$/.test(digits)) {
    normalized = `+254${digits.slice(1)}`;
  } else if (/^254[17]\d{8}$/.test(digits)) {
    normalized = `+${digits}`;
  }
  if (!normalized) {
    throw new SaleValidationError(
      'invalid-phone',
      field,
      `${field} must be a valid Kenyan mobile number (e.g. 0712345678).`,
    );
  }
  return normalized;
}
