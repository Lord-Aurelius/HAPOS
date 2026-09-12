/**
 * Shared QR ownership rule (correction loop §1, §9–§10).
 *
 * One rule for booking, attendance and seller QR management:
 * - `shop_admin` operates ONLY their own tenant's QR material,
 * - `super_admin` retains platform support access across tenants
 *   (operational/emergency support; QR renders are tenant-scoped reads),
 * - everyone else (including staff) is denied — no QR management.
 *
 * Routes map the thrown code to their own 403 message; the rule itself is
 * tested here, not re-implemented per route. Runs under `node --test`.
 */

export type QrAccessCode = 'cross-tenant' | 'missing-context' | 'forbidden-role';

export class QrAccessError extends Error {
  readonly code: QrAccessCode;

  constructor(code: QrAccessCode, message: string) {
    super(message);
    this.name = 'QrAccessError';
    this.code = code;
  }
}

export type QrSession = {
  user: { role: string };
  tenant: { id: string } | null;
};

/**
 * Enforce merchant QR ownership. Returns silently when allowed.
 *
 * @param session Authenticated session (roles already enforced by the route).
 * @param tenantId Tenant owning the QR material being accessed.
 */
export function checkQrTenantAccess(session: QrSession, tenantId: string): void {
  if (session.user.role === 'super_admin') {
    return;
  }
  if (session.user.role !== 'shop_admin') {
    throw new QrAccessError('forbidden-role', 'QR management requires a shop admin.');
  }
  if (!session.tenant) {
    throw new QrAccessError('missing-context', 'QR management requires a shop context.');
  }
  if (session.tenant.id !== tenantId) {
    throw new QrAccessError('cross-tenant', 'QR material belongs to another shop.');
  }
}
