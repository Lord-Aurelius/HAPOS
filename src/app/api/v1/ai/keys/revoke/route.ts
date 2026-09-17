import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';
import { ApiKeyError, revokeApiKey } from '@/server/auth/api-keys';
import { updateStore } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Revoke a key (interactive sessions only). Normal keys revoke within the
 * caller's tenant; master rows revoke only through an explicit master-scope
 * call by a super_admin.
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session || (session.user.role !== 'shop_admin' && session.user.role !== 'super_admin')) {
    return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Key management requires a shop admin.', retryable: false } }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; scope?: unknown; tenantId?: unknown };
  if (typeof body.id !== 'string' || !body.id) {
    return NextResponse.json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Key id is required.', retryable: false } }, { status: 400 });
  }
  const tenantId = session.tenant?.id
    ?? (session.user.role === 'super_admin' && typeof body.tenantId === 'string' ? body.tenantId : null);
  try {
    await updateStore((store) =>
      revokeApiKey(store as never, {
        id: body.id as string,
        tenantId,
        scope: body.scope === 'master' ? 'master' : null,
      }),
    );
    return NextResponse.json({ ok: true, data: { revoked: body.id } });
  } catch (error) {
    if (error instanceof ApiKeyError) {
      const status = error.code === 'forbidden' ? 403 : error.code === 'unknown-key' ? 404 : 400;
      return NextResponse.json({ ok: false, error: { code: error.code === 'unknown-key' ? 'NOT_FOUND' : error.code === 'forbidden' ? 'FORBIDDEN' : 'INVALID_ARGUMENT', message: error.message, retryable: false } }, { status });
    }
    throw error;
  }
}
