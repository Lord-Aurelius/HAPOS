import { apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { listTenants } from '@/server/services/app-data';
import { updateStore } from '@/server/store';

type RouteProps = {
  params: Promise<{ tenantId: string }>;
};

export async function POST(_: Request, { params }: RouteProps) {
  await requireSession(['super_admin']);
  const { tenantId } = await params;
  await updateStore((store) => {
    const tenant = store.tenants.find((item) => item.id === tenantId);
    if (tenant) {
      tenant.status = 'suspended';
      tenant.suspensionReason = 'Suspended by super admin';
      tenant.updatedAt = new Date().toISOString();
    }

    const subscription = store.subscriptions.find((item) => item.tenantId === tenantId);
    if (subscription) {
      subscription.status = 'suspended';
      subscription.updatedAt = new Date().toISOString();
    }
  });
  const tenant = (await listTenants()).find((item) => item.id === tenantId);

  return apiOk({
    ...(tenant ?? {
      id: tenantId,
      name: 'Unknown tenant',
      slug: 'unknown',
      timezone: 'Africa/Nairobi',
      countryCode: 'KE',
      currencyCode: 'KES',
    }),
    status: 'suspended',
  });
}
