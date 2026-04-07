import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import type { CustomerAppSession } from '@/lib/types';
import { createCustomerSession, deleteCustomerSession, getCustomerSession } from '@/server/store';
import { getAccessState } from '@/server/auth/access';
import { shouldUseSecureCookies } from '@/server/runtime';

export const CUSTOMER_SESSION_COOKIE = 'hapos_customer_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

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

export async function getCurrentCustomerSession(): Promise<CustomerAppSession | null> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const sessionId =
    cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value ??
    parseCookieHeader(headerStore.get('cookie') ?? '', CUSTOMER_SESSION_COOKIE);

  if (!sessionId) {
    return null;
  }

  return getCustomerSession(sessionId);
}

export async function requireCustomerSession(): Promise<CustomerAppSession> {
  const session = await getCurrentCustomerSession();

  if (!session) {
    redirect('/customer/login');
  }

  const accessState = getAccessState({
    tenantStatus: session.tenant.status,
    suspensionReason: session.tenant.suspensionReason,
    subscriptionStatus: session.subscription?.status,
    endsAt: session.subscription?.endsAt,
    graceEndsAt: session.subscription?.graceEndsAt,
  });

  if (accessState.blocked) {
    redirect('/customer/login?error=blocked');
  }

  return session;
}

export async function signInCustomerSession(input: { customerId: string; tenantId: string }) {
  const session = await createCustomerSession(input);
  const cookieStore = await cookies();
  cookieStore.set(CUSTOMER_SESSION_COOKIE, session.id, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
    secure: shouldUseSecureCookies(),
  });
}

export async function signOutCustomerSession() {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(CUSTOMER_SESSION_COOKIE)?.value;
  if (sessionId) {
    await deleteCustomerSession(sessionId);
  }
  cookieStore.delete(CUSTOMER_SESSION_COOKIE);
}
