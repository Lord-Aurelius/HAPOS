/**
 * AEGIS principal resolution + shop grounding.
 *
 * Identity chain: session cookie or API-key secret → principal
 * (`user` bound to one tenant, or platform `master`) → validated shop
 * context. Tenant/shop IDs are never accepted from request bodies for normal
 * principals; master principals must present a shopId that resolves against
 * the authoritative tenant registry on every call (no trusted arbitrary IDs,
 * no sticky server-side selection that could go stale).
 */

import { getTenantById, readStore, updateStore } from '@/server/store';
import { resolveApiKeyPrincipal, touchApiKeyUsed } from '@/server/auth/api-keys';
import { AiError } from '@/server/aegis/errors';
import { resolveShopContext, type ShopContext, type TenantRow } from '@/server/aegis/grounding';

export type { ShopContext, TenantRow };

export type AegisPrincipal =
  | { kind: 'user'; userId: string; tenantId: string; role: string; keyId: string | null }
  | { kind: 'master'; keyId: string | null };

export type SessionShape = {
  user: { id: string; role: string };
  tenant: { id: string } | null;
} | null;

function bearerSecret(request: Request): string | null {
  const header = request.headers.get('authorization') ?? request.headers.get('x-api-key') ?? '';
  const trimmed = header.trim();
  if (!trimmed) {
    return null;
  }
  const bearer = /^bearer\s+/i.exec(trimmed);
  return (bearer ? trimmed.slice(bearer[0].length) : trimmed).trim() || null;
}

/**
 * Resolve the caller to a principal. API-key secrets win when present;
 * otherwise the session is used. Returns null when neither authenticates.
 */
export async function resolvePrincipal(request: Request, session: SessionShape): Promise<AegisPrincipal | null> {
  const secret = bearerSecret(request);
  if (secret) {
    const store = await readStore();
    const resolved = resolveApiKeyPrincipal(store as never, secret);
    if (!resolved) {
      throw new AiError('UNAUTHORIZED', 'Unknown or revoked API key.', false);
    }
    if (resolved.kind === 'master') {
      return { kind: 'master', keyId: resolved.keyId };
    }
    return { kind: 'user', userId: resolved.userId, tenantId: resolved.tenantId, role: resolved.role, keyId: resolved.keyId };
  }
  if (session && session.tenant) {
    return { kind: 'user', userId: session.user.id, tenantId: session.tenant.id, role: session.user.role, keyId: null };
  }
  return null;
}

export function requirePrincipal(principal: AegisPrincipal | null): AegisPrincipal {
  if (!principal) {
    throw new AiError('UNAUTHORIZED', 'Authentication is required.', false);
  }
  return principal;
}

/**
 * Route-level authentication: API-key secret (Bearer or x-api-key) wins,
 * otherwise the session. Successful key authentication throttles a last-used
 * touch (hourly) for operability without per-request write storms.
 */
export async function authenticateRequest(request: Request, session: SessionShape): Promise<AegisPrincipal | null> {
  const principal = await resolvePrincipal(request, session);
  if (principal && principal.keyId) {
    try {
      await updateStore((store) => {
        touchApiKeyUsed(store as never, { id: principal.keyId as string });
      });
    } catch {
      /* usage touch never blocks authentication */
    }
  }
  return principal;
}

/** Validate one shop for the principal (master callers re-validate per call). */
export async function shopContextForPrincipal(principal: AegisPrincipal, shopId: unknown): Promise<ShopContext> {
  if (principal.kind === 'user') {
    const tenant = await getTenantById(principal.tenantId);
    return resolveShopContext(tenant ? [tenant] : [], principal, shopId);
  }
  const { listTenantsStore } = await import('@/server/store');
  const tenants = await listTenantsStore();
  return resolveShopContext(tenants, principal, shopId);
}
