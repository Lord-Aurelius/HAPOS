/**
 * Canonical commerce commission calculation (Phase 0 foundation).
 *
 * `src/server/services/app-data.ts` delegates to this module so the rule has
 * exactly one implementation. Behaviour is intentionally identical to the
 * pre-Phase-0 logic:
 * - staff terms override service terms when present,
 * - `fixed` pays the flat value,
 * - `percentage` pays `round(price * value / 100)`.
 */

export type CommerceCommissionType = 'fixed' | 'percentage';

export type CommerceCommissionParty = {
  commissionType?: CommerceCommissionType | null;
  commissionValue?: number | null;
} | null | undefined;

export type CommerceCommissionResult = {
  commissionType: CommerceCommissionType;
  commissionValue: number;
  commissionAmount: number;
};

export function calculateCommerceCommission(input: {
  service?: CommerceCommissionParty;
  staff?: CommerceCommissionParty;
  price: number;
}): CommerceCommissionResult {
  const commissionType = input.staff?.commissionType ?? input.service?.commissionType ?? 'percentage';
  const commissionValue = input.staff?.commissionValue ?? input.service?.commissionValue ?? 0;
  const commissionAmount =
    commissionType === 'fixed' ? commissionValue : Math.round((input.price * commissionValue) / 100);

  return { commissionType, commissionValue, commissionAmount };
}
