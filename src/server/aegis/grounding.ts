/**
 * Pure shop-grounding core (unit-testable; dependency-free).
 *
 * Normal principals are pinned to their own tenant — any other shopId fails.
 * Master principals must name a real tenant from the authoritative registry
 * on every call; invented IDs fail. Shop identity is the tenant identity
 * (HAPOS maps shops 1:1 to tenants; no competing identifier exists).
 */

import { AiError } from './errors.ts';

export type GroundPrincipal =
  | { kind: 'user'; tenantId: string }
  | { kind: 'master' };

export type TenantRow = { id: string; name: string; slug: string; status?: string | null };

export type ShopContext = {
  tenantId: string;
  /** Canonical shop identity (equals tenantId while shops map 1:1 to tenants). */
  shopId: string;
  shopName: string;
};

export function resolveShopContext(tenants: TenantRow[], principal: GroundPrincipal, shopId: unknown): ShopContext {
  if (principal.kind === 'user') {
    if (shopId !== undefined && shopId !== null && String(shopId) !== principal.tenantId) {
      throw new AiError('WRONG_SHOP', 'That shop is outside this connection’s tenant.', false);
    }
    const tenant = tenants.find((item) => item.id === principal.tenantId) ?? null;
    if (!tenant) {
      throw new AiError('WRONG_TENANT', 'The connection tenant no longer exists.', false);
    }
    return { tenantId: tenant.id, shopId: tenant.id, shopName: tenant.name };
  }
  const requested = typeof shopId === 'string' ? shopId.trim() : '';
  if (!requested) {
    throw new AiError('INVALID_ARGUMENT', 'Master calls must name a shopId.', false);
  }
  const tenant = tenants.find((item) => item.id === requested) ?? null;
  if (!tenant) {
    throw new AiError('WRONG_SHOP', 'Unknown shop. Select a shop from platform.shops.list.', false);
  }
  return { tenantId: tenant.id, shopId: tenant.id, shopName: tenant.name };
}
