import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';
import { invokeCapability } from '@/server/aegis/pipeline';
import { authenticateRequest } from '@/server/aegis/principal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Grounded capability invocation (GATE 17 pipeline). Auth: session cookie or
 * `Authorization: Bearer <api key>`. Master callers pass `shopId` per call;
 * normal callers are pinned to their key/session tenant (a foreign shopId is
 * rejected, never trusted).
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();
  let principal;
  try {
    principal = await authenticateRequest(
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

  const body = (await request.json().catch(() => ({}))) as {
    capability?: unknown;
    args?: Record<string, unknown>;
    shopId?: unknown;
    confirm?: unknown;
  };

  const result = await invokeCapability({
    principal,
    shopId: body.shopId ?? request.headers.get('x-hapos-shop') ?? undefined,
    capability: body.capability,
    args: body.args,
    confirm: body.confirm === true,
  });

  if (result.ok) {
    return NextResponse.json(result);
  }
  const status = result.error.code === 'UNAUTHORIZED' ? 401
    : result.error.code === 'FORBIDDEN' || result.error.code === 'WRONG_TENANT' || result.error.code === 'WRONG_SHOP' ? 403
    : result.error.code === 'NOT_FOUND' ? 404
    : result.error.code === 'INVALID_ARGUMENT' ? 400
    : result.error.code === 'CONFLICT' || result.error.code === 'ALREADY_COMPLETED' ? 409
    : result.error.code === 'CONFIRMATION_REQUIRED' ? 428
    : result.error.code === 'RATE_LIMITED' ? 429
    : result.error.code === 'TEMPORARY_FAILURE' ? 503
    : 500;
  return NextResponse.json(result, { status });
}
