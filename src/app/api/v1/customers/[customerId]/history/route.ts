import { apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { listServiceRecords } from '@/server/services/app-data';

type RouteProps = {
  params: Promise<{ customerId: string }>;
};

export async function GET(_: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return apiOk({ items: [] });
  }
  const { customerId } = await params;
  const items = (await listServiceRecords(session.tenant.id)).filter((item) => item.customerId === customerId);

  return apiOk({ items });
}
