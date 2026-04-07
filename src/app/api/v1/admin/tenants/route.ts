import { apiCreated, apiOk } from '@/server/http/api';
import { normalizePlanCode } from '@/lib/plans';
import { requireSession } from '@/server/auth/demo-session';
import { listSubscriptionPackages, listTenants } from '@/server/services/app-data';
import { updateStore } from '@/server/store';
import { randomUUID } from 'node:crypto';

export async function GET() {
  await requireSession(['super_admin']);
  return apiOk({ items: await listTenants(), packages: await listSubscriptionPackages() });
}

export async function POST(request: Request) {
  await requireSession(['super_admin']);
  const body = await request.json();
  const created = await updateStore((store) => {
    const now = new Date().toISOString();
    const tenantId = randomUUID();
    const selectedPackage =
      (body.packageId ? store.subscriptionPackages.find((item) => item.id === body.packageId) : null) ??
      store.subscriptionPackages.find((item) => item.code === normalizePlanCode(body.planCode ?? 'basic')) ??
      store.subscriptionPackages.find((item) => item.code === 'basic') ??
      null;
    const record = {
      id: tenantId,
      name: body.name,
      ownerName: body.ownerName ?? null,
      slug: body.slug,
      timezone: body.timezone ?? 'Africa/Nairobi',
      countryCode: 'KE',
      currencyCode: body.currencyCode ?? 'KES',
      status: 'active' as const,
      createdAt: now,
      updatedAt: now,
    };
    store.tenants.push(record);
    store.subscriptions.push({
      id: randomUUID(),
      tenantId,
      packageId: selectedPackage?.id ?? null,
      planCode: selectedPackage?.code ?? normalizePlanCode(body.planCode ?? 'basic'),
      status: 'active',
      startsAt: now,
      endsAt: body.endsAt ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(),
      amount: Number(body.amount ?? selectedPackage?.amount ?? 0),
      currencyCode: body.currencyCode ?? selectedPackage?.currencyCode ?? 'KES',
      autoRenew: Boolean(body.autoRenew),
      paymentTerms: body.paymentTerms,
      updatedAt: now,
    });
    return record;
  });
  return apiCreated(created);
}
