import { apiOk } from '@/server/http/api';
import { getAccessState } from '@/server/auth/access';
import { getCurrentSession } from '@/server/auth/demo-session';

export async function GET() {
  const session = await getCurrentSession();
  const accessState =
    session && session.user.role !== 'super_admin'
      ? getAccessState({
          tenantStatus: session.tenant?.status,
          suspensionReason: session.tenant?.suspensionReason,
          subscriptionStatus: session.subscription?.status,
          endsAt: session.subscription?.endsAt,
          graceEndsAt: session.subscription?.graceEndsAt,
        })
      : { blocked: false, reason: 'ok' as const, message: 'Access allowed.' };

  return apiOk(
    session
      ? {
          user: session.user,
          tenant: session.tenant,
          subscriptionActive: !accessState.blocked,
          blocked: accessState.blocked,
          blockedReason: accessState.reason,
        }
      : { user: null, tenant: null, subscriptionActive: false, blocked: false, blockedReason: 'ok' },
  );
}
