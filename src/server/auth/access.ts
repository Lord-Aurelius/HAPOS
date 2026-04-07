import type { SubscriptionStatus, TenantStatus } from '@/lib/types';

export type AccessState = {
  blocked: boolean;
  reason:
    | 'ok'
    | 'missing_tenant'
    | 'tenant_suspended'
    | 'tenant_inactive'
    | 'subscription_missing'
    | 'subscription_suspended'
    | 'subscription_cancelled'
    | 'subscription_expired';
  message: string;
};

type AccessInput = {
  tenantStatus?: TenantStatus | null;
  suspensionReason?: string | null;
  subscriptionStatus?: SubscriptionStatus | null;
  endsAt?: string | null;
  graceEndsAt?: string | null;
};

const ACTIVE_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = ['trialing', 'active', 'past_due'];

export function getAccessState(input: AccessInput): AccessState {
  if (!input.tenantStatus) {
    return {
      blocked: true,
      reason: 'missing_tenant',
      message: 'This account is not attached to an active business.',
    };
  }

  if (input.tenantStatus === 'suspended') {
    return {
      blocked: true,
      reason: 'tenant_suspended',
      message:
        input.suspensionReason?.trim() ||
        'This business has been suspended by the House Aurelius Point of Sale super admin.',
    };
  }

  if (input.tenantStatus !== 'active') {
    return {
      blocked: true,
      reason: 'tenant_inactive',
      message: 'This business is currently inactive and cannot access HAPOS.',
    };
  }

  if (!input.subscriptionStatus) {
    return {
      blocked: true,
      reason: 'subscription_missing',
      message: 'This business does not have an active licence record.',
    };
  }

  if (input.subscriptionStatus === 'suspended') {
    return {
      blocked: true,
      reason: 'subscription_suspended',
      message: 'This business licence has been suspended.',
    };
  }

  if (input.subscriptionStatus === 'cancelled') {
    return {
      blocked: true,
      reason: 'subscription_cancelled',
      message: 'This business licence has been cancelled.',
    };
  }

  const expiry = input.graceEndsAt ?? input.endsAt;
  if (
    !ACTIVE_SUBSCRIPTION_STATUSES.includes(input.subscriptionStatus) ||
    (expiry ? new Date(expiry).getTime() < Date.now() : false)
  ) {
    return {
      blocked: true,
      reason: 'subscription_expired',
      message: 'This business licence has expired and must be renewed before access resumes.',
    };
  }

  return {
    blocked: false,
    reason: 'ok',
    message: 'Access allowed.',
  };
}
