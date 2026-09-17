import { NextResponse } from 'next/server';
import { getCurrentSession } from '@/server/auth/demo-session';
import { listApiKeyMetadata, mintApiKey, ApiKeyError } from '@/server/auth/api-keys';
import { readStore, updateStore } from '@/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sessionShape(session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>) {
  return {
    userId: session.user.id,
    role: session.user.role,
    tenantId: session.tenant?.id ?? null,
  };
}

/**
 * API-key management (interactive sessions only — never bearer keys).
 * GET lists key metadata for the caller's tenant (hashes never leave).
 * Master-scope rows surface only to super_admin.
 */
export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session || (session.user.role !== 'shop_admin' && session.user.role !== 'super_admin')) {
    return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Key management requires a shop admin.', retryable: false } }, { status: 403 });
  }
  const url = new URL(request.url);
  const tenantId = session.user.role === 'super_admin' ? (url.searchParams.get('tenantId') ?? session.tenant?.id ?? null) : (session.tenant?.id ?? null);
  const store = await readStore();
  const keys = listApiKeyMetadata(store as never, { tenantId, includeMaster: session.user.role === 'super_admin' });
  return NextResponse.json({ ok: true, data: { keys } });
}

/**
 * Mint a key. The secret is returned ONCE — it is never persisted and can
 * never be read back. Normal scope binds tenant + user (staff may only bind
 * themselves); master scope requires a super_admin minter.
 */
export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session || (session.user.role !== 'shop_admin' && session.user.role !== 'super_admin')) {
    return NextResponse.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Key management requires a shop admin.', retryable: false } }, { status: 403 });
  }
  const me = sessionShape(session);
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    scope?: unknown;
    tenantId?: unknown;
    userId?: unknown;
    expiresAt?: unknown;
  };

  try {
    const scope = body.scope === 'master' ? 'master' : 'normal';
    const tenantId = scope === 'master' ? null : me.role === 'super_admin' && typeof body.tenantId === 'string' && body.tenantId ? body.tenantId : me.tenantId;
    const userId = scope === 'master' ? null : body.userId === undefined || body.userId === null || body.userId === '' ? me.userId : String(body.userId);
    const minted = await updateStore((store) =>
      mintApiKey(store as never, {
        scope,
        tenantId,
        userId,
        name: typeof body.name === 'string' ? body.name : '',
        createdBy: me.userId,
        minterRole: me.role,
        expiresAt: typeof body.expiresAt === 'string' && body.expiresAt ? body.expiresAt : null,
      }),
    );
    const [metadata] = listApiKeyMetadata({ apiKeys: [minted.record], users: [] } as never, { tenantId: null, includeMaster: true });
    return NextResponse.json({ ok: true, data: { secret: minted.secret, key: metadata, warning: 'Store this secret now. It cannot be read back.' } });
  } catch (error) {
    if (error instanceof ApiKeyError) {
      const status = error.code === 'forbidden' ? 403 : 400;
      return NextResponse.json({ ok: false, error: { code: error.code === 'forbidden' ? 'FORBIDDEN' : 'INVALID_ARGUMENT', message: error.message, retryable: false } }, { status });
    }
    throw error;
  }
}
