import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';
import { advertisedCapabilities } from '@/server/aegis/capabilities';
import { authenticateRequest, requirePrincipal, shopContextForPrincipal } from '@/server/aegis/principal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Connection advertisement (GATE 12). Returns the authoritative grounding
 * context plus exactly the capabilities this principal may execute.
 * Auth: session cookie or `Authorization: Bearer <api key>`.
 * Master callers may pass `?shop=<shopId>` to receive grounded shop context.
 */
export async function GET(request: Request) {
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

  let principal;
  try {
    principal = requirePrincipal(found);
  } catch (error) {
    const known = error as { status?: number; toBody?: () => unknown };
    return NextResponse.json(
      { ok: false, error: known.toBody ? known.toBody() : { code: 'UNAUTHORIZED', message: 'Authentication is required.', retryable: false } },
      { status: known.status ?? 401 },
    );
  }

  const url = new URL(request.url);
  const shopParam = url.searchParams.get('shop') ?? request.headers.get('x-hapos-shop') ?? undefined;

  if (principal.kind === 'master' && !shopParam) {
    const capabilities = advertisedCapabilities('master').filter((capability) => capability.id.startsWith('platform.'));
    return NextResponse.json({
      ok: true,
      data: {
        application: 'HAPOS',
        principal: { kind: 'master', role: 'master', keyId: principal.keyId },
        authority: 'master',
        tenant: null,
        grounding: 'Select a shop via platform.shops.list, then reconnect with ?shop=<shopId>.',
        capabilities,
        events: { transport: 'sse', url: '/api/v1/ai/events', note: 'Requires ?shop=<shopId> for master callers.' },
      },
    });
  }

  try {
    const shop = await shopContextForPrincipal(principal, shopParam);
    const role = principal.kind === 'master' ? 'master' : principal.role;
    return NextResponse.json({
      ok: true,
      data: {
        application: 'HAPOS',
        principal:
          principal.kind === 'master'
            ? { kind: 'master', role: 'master', keyId: principal.keyId }
            : { kind: 'user', userId: principal.userId, role: principal.role, keyId: principal.keyId },
        authority: principal.kind,
        tenant: { tenantId: shop.tenantId, shopId: shop.shopId, shopName: shop.shopName },
        capabilities: advertisedCapabilities(role),
        events: { transport: 'sse', url: '/api/v1/ai/events' },
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
