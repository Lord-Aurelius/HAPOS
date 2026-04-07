import type { Subscription, SubscriptionPackage } from '@/lib/types';

export function normalizePlanCode(planCode: string | null | undefined) {
  const value = (planCode ?? '').trim().toLowerCase();

  if (value === 'growth' || value === 'platinum') {
    return 'platinum';
  }

  if (value === 'starter' || value === 'basic') {
    return 'basic';
  }

  return value.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'basic';
}

export function isPlatinumPlan(planCode: string | null | undefined) {
  return normalizePlanCode(planCode) === 'platinum';
}

export function formatPlanCode(planCode: string | null | undefined) {
  const normalized = normalizePlanCode(planCode);

  if (normalized === 'platinum') {
    return 'Platinum';
  }

  if (normalized === 'basic') {
    return 'Basic';
  }

  return normalized
    ? normalized
        .split('-')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
    : 'Basic';
}

export function getDefaultSubscriptionPackageBlueprints() {
  return [
    {
      code: 'basic',
      name: 'Basic',
      description: 'Core HAPOS tools for daily operations, reporting, staff logins, and customer tracking.',
      features: [
        'Tenant-isolated dashboard and reports',
        'Staff logins with commission tracking',
        'Customer portal for visits and price list',
        'SMS thank-you and promotions',
      ],
      amount: 8500,
      currencyCode: 'KES',
      billingPeriod: 'monthly' as const,
      includesMarketplace: false,
      includesCustomerMarketplace: false,
      isActive: true,
    },
    {
      code: 'platinum',
      name: 'Platinum',
      description: 'Everything in Basic, plus the shared marketplace for shops and customers.',
      features: [
        'Everything in Basic',
        'Marketplace adverts for approved shop promotions',
        'Marketplace visibility for customers of eligible shops',
        'Premium discovery across HAPOS platinum tenants',
      ],
      amount: 12500,
      currencyCode: 'KES',
      billingPeriod: 'monthly' as const,
      includesMarketplace: true,
      includesCustomerMarketplace: true,
      isActive: true,
    },
  ];
}

export function getSubscriptionDisplayName(subscription: Pick<Subscription, 'packageName' | 'planCode'> | null | undefined) {
  return subscription?.packageName?.trim() || formatPlanCode(subscription?.planCode);
}

export function packageIncludesMarketplace(
  plan: Pick<SubscriptionPackage, 'includesMarketplace' | 'code'> | null | undefined,
) {
  if (!plan) {
    return false;
  }

  return Boolean(plan.includesMarketplace) || isPlatinumPlan(plan.code);
}

export function packageIncludesCustomerMarketplace(
  plan: Pick<SubscriptionPackage, 'includesCustomerMarketplace' | 'includesMarketplace' | 'code'> | null | undefined,
) {
  if (!plan) {
    return false;
  }

  return Boolean(plan.includesCustomerMarketplace) || packageIncludesMarketplace(plan);
}

export function subscriptionIncludesMarketplace(
  subscription: Pick<Subscription, 'includesMarketplace' | 'planCode'> | null | undefined,
) {
  if (!subscription) {
    return false;
  }

  return Boolean(subscription.includesMarketplace) || isPlatinumPlan(subscription.planCode);
}

export function subscriptionIncludesCustomerMarketplace(
  subscription: Pick<Subscription, 'includesCustomerMarketplace' | 'includesMarketplace' | 'planCode'> | null | undefined,
) {
  if (!subscription) {
    return false;
  }

  return Boolean(subscription.includesCustomerMarketplace) || subscriptionIncludesMarketplace(subscription);
}
