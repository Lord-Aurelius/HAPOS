import { NextResponse } from 'next/server';

import { getAccessState } from '@/server/auth/access';
import { SESSION_COOKIE, applySessionCookie } from '@/server/auth/demo-session';
import { buildLoginRateLimitKey, getLoginRateLimiter } from '@/server/auth/rate-limit';
import { apiBadRequest, apiOk } from '@/server/http/api';
import { authenticateUser, createSession, deleteSession } from '@/server/store';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { businessSlug?: string; username?: string; password?: string }
    | null;

  if (!body?.businessSlug || !body?.username || !body?.password) {
    return apiBadRequest('Business slug, username, and password are required.');
  }

  // Phase 0.9: blunt-force protection scoped per shop + username.
  const limitKey = buildLoginRateLimitKey(body.businessSlug, body.username);
  const limitDecision = getLoginRateLimiter().attempt(limitKey);
  if (!limitDecision.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Wait a few minutes and try again.' },
      { status: 429 },
    );
  }

  const auth = await authenticateUser({
    businessSlug: body.businessSlug,
    username: body.username,
    password: body.password,
  });

  if (!auth) {
    return apiBadRequest('Invalid credentials.', 401);
  }

  const session = await createSession({
    userId: auth.user.id,
    tenantId: auth.tenant?.id ?? null,
    role: auth.user.role,
  });
  const accessState =
    auth.user.role === 'super_admin'
      ? { blocked: false, reason: 'ok' as const, message: 'Access allowed.' }
      : getAccessState({
          tenantStatus: auth.tenant?.status,
          suspensionReason: auth.tenant?.suspensionReason,
          subscriptionStatus: auth.subscription?.status,
          endsAt: auth.subscription?.endsAt,
          graceEndsAt: auth.subscription?.graceEndsAt,
        });

  // Phase 0.9: never hand out a usable session to a blocked tenant. The
  // provisional session is destroyed before responding.
  if (accessState.blocked) {
    await deleteSession(session.id);
    return NextResponse.json(
      {
        blocked: true,
        blockedReason: accessState.reason,
        message: accessState.message,
      },
      { status: 403 },
    );
  }

  getLoginRateLimiter().reset(limitKey);
  const response = apiOk({
    accessToken: 'session-cookie-auth',
    sessionCookie: SESSION_COOKIE,
    blocked: accessState.blocked,
    blockedReason: accessState.reason,
    user: {
      id: auth.user.id,
      tenantId: auth.user.tenantId,
      fullName: auth.user.fullName,
      email: auth.user.email,
      role: auth.user.role,
      username: auth.user.username,
    },
  });
  applySessionCookie(response, session.id);
  return response;
}
