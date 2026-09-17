import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';
import { advertisedCapabilities } from '@/server/aegis/capabilities';
import { AiError } from '@/server/aegis/errors';
import { authenticateRequest, requirePrincipal, shopContextForPrincipal } from '@/server/aegis/principal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Master shop grounding receipt (GATE 11). Validates the requested shopId
 * against the authoritative tenant registry and returns the grounded context
 * AEGIS must use for subsequent shop-scoped calls. Stateless: every invoke
 * re-validates, so no stale shop context can survive a switch. Master only.
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();
  let found;
  try {
    found = await authenticateRequest(
      request,
      session ? { user: { id: session.user.id, role: session.user.role }, tenant: session.tenant ? { id: session.tenant.id } : null } : null,
    );
  } catch (error) {
    const known = error as { status?: number; toBody?: () => unknown; message?: string };
    return NextResponse.json(
      { ok: false, error: known.toBody ? known.toBody() : { code: 'UNAUTHORIZED', message: known.message ?? 'Authentication failed.', retryable: false } },
      { status: known.status ?? 401 },
    );
  }

  try {
    const principal = requirePrincipal(found);
    if (principal.kind !== 'master') {
      throw new AiError('FORBIDDEN', 'Shop grounding selection is a master-authority operation.', false);
    }
    const body = (await request.json().catch(() => ({}))) as { shopId?: unknown };
    const shop = await shopContextForPrincipal(principal, body.shopId);
    return NextResponse.json({
      ok: true,
      data: {
        application: 'HAPOS',
        authority: 'master',
        tenant: { tenantId: shop.tenantId, shopId: shop.shopId, shopName: shop.shopName },
        useShopId: shop.shopId,
        capabilities: advertisedCapabilities('master').filter((capability) => !capability.id.startsWith('platform.')),
      },
    });
  } catch (error) {
    const known = error as { status?: number; toBody?: () => unknown; message?: string };
    return NextResponse.json(
      { ok: false, error: known.toBody ? known.toBody() : { code: 'INTERNAL_ERROR', message: known.message ?? 'Failed.', retryable: false } },
      { status: known.status ?? 500 },
    );
  }
}
