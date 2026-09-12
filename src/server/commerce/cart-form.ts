/**
 * Cart form normalization (correction loop, quantity defect).
 *
 * Root cause fixed here: the old row-skip required kind+refId+quantity ALL
 * empty, but kind (a <select>) always submits — so untouched rows became
 * phantom `{refId:'', quantity:0}` lines and poisoned every cart with
 * `invalid-quantity` errors that masked valid qty-1 lines.
 *
 * Contract (single implementation for the admin panel and the QR flow):
 * - a row with a blank item reference is NOT a line (skipped regardless of
 *   the other fields — the UI defaults quantity to 1 on every row),
 * - a selected item requires quantity = positive whole number (`integer>=1`),
 * - `"1"` and `1` are valid; `""`, `0`, negatives, fractions and malformed
 *   values are rejected explicitly (never coerced to 0),
 * - actual price follows the same explicitness (blank = catalog).
 *
 * Dependency-free: runs under `node --test`.
 */

import type { CartLineRequest } from './orders.ts';

export type CartFormEntries = Iterable<readonly [string, FormDataEntryValue | string]>;

export class CartFormError extends Error {
  readonly code: 'empty-order' | 'invalid-quantity' | 'invalid-price' | 'unknown-item';

  constructor(code: CartFormError['code'], message: string) {
    super(message);
    this.name = 'CartFormError';
    this.code = code;
  }
}

const ROW_COUNT = 4;

function field(entries: Map<string, string>, key: string): string {
  return entries.get(key) ?? '';
}

function parseQuantity(raw: string, rowLabel: string): number {
  const text = raw.trim();
  if (!text) {
    throw new CartFormError('invalid-quantity', `${rowLabel}: quantity is required (positive whole number).`);
  }
  const value = Number(text);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new CartFormError('invalid-quantity', `${rowLabel}: quantity must be a whole number, got ${JSON.stringify(text)}.`);
  }
  if (value < 1) {
    throw new CartFormError('invalid-quantity', `${rowLabel}: quantity must be at least 1.`);
  }
  return value;
}

function parseActualPrice(raw: string, rowLabel: string): number | null {
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) {
    throw new CartFormError('invalid-price', `${rowLabel}: actual price must be a valid amount of zero or more.`);
  }
  return value;
}

/**
 * Normalize fixed cart rows (`line_<i>_kind/refId/quantity/actual/reason`).
 * Blank-item rows are skipped; selected rows are strictly validated.
 */
export function parseCartFormEntries(entries: CartFormEntries, rowCount = ROW_COUNT): CartLineRequest[] {
  const fields = new Map<string, string>();
  for (const [key, value] of entries) {
    fields.set(key, typeof value === 'string' ? value : '');
  }

  const lines: CartLineRequest[] = [];
  for (let index = 0; index < rowCount; index += 1) {
    const rowLabel = `Item ${index + 1}`;
    const refId = field(fields, `line_${index}_refId`).trim();
    if (!refId) {
      continue;
    }
    const kind = field(fields, `line_${index}_kind`).trim();
    if (kind !== 'product' && kind !== 'service') {
      throw new CartFormError('unknown-item', `${rowLabel}: item type must be product or service.`);
    }
    lines.push({
      kind,
      refId,
      quantity: parseQuantity(field(fields, `line_${index}_quantity`), rowLabel),
      actualUnitPrice: parseActualPrice(field(fields, `line_${index}_actual`), rowLabel),
      overrideReason: field(fields, `line_${index}_reason`).trim() || null,
    });
  }

  if (lines.length === 0) {
    throw new CartFormError('empty-order', 'Select at least one product or service.');
  }
  return lines;
}
