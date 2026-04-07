import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';

import type { AppSession, UserRole } from '@/lib/types';
import { createSession, deleteSession, getSession } from '@/server/store';
import { getAccessState } from '@/server/auth/access';
import { shouldUseSecureCookies } from '@/server/runtime';

export const SESSION_COOKIE = 'hapos_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function parseCookieHeader(cookieHeader: string, name: string) {
  const parts = cookieHeader.split(';');

  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      return rest.join('=');
    }
  }

  return null;
}

type RequireSessionOptions = {
  allowBlocked?: boolean;
};

export async function getCurrentSession(): Promise<AppSession | null> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const sessionId =
    cookieStore.get(SESSION_COOKIE)?.value ??
    parseCookieHeader(headerStore.get('cookie') ?? '', SESSION_COOKIE);

  if (!sessionId) {
    return null;
  }

  return getSession(sessionId);
}

export async function requireSession(
  roles?: UserRole[],
  options: RequireSessionOptions = {},
): Promise<AppSession> {
  const session = await getCurrentSession();

  if (!session) {
    redirect('/login');
  }

  if (roles && !roles.includes(session.user.role)) {
    redirect(session.user.role === 'super_admin' ? '/super/tenants' : '/app/dashboard');
  }

  if (!options.allowBlocked && session.user.role !== 'super_admin') {
    const accessState = getAccessState({
      tenantStatus: session.tenant?.status,
      suspensionReason: session.tenant?.suspensionReason,
      subscriptionStatus: session.subscription?.status,
      endsAt: session.subscription?.endsAt,
      graceEndsAt: session.subscription?.graceEndsAt,
    });

    if (accessState.blocked) {
      redirect(`/blocked?reason=${accessState.reason}`);
    }
  }

  return session;
}

export async function signInSession(input: { userId: string; tenantId: string | null; role: UserRole }) {
  const session = await createSession(input);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
    secure: shouldUseSecureCookies(),
  });
}

export async function signOutSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (sessionId) {
    await deleteSession(sessionId);
  }
  cookieStore.delete(SESSION_COOKIE);
}

export function applySessionCookie(response: NextResponse, sessionId: string) {
  response.cookies.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
    secure: shouldUseSecureCookies(),
  });
}
