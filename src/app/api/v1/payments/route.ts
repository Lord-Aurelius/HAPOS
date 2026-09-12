import { apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { getCommerceRepository } from '@/server/commerce/repository-select';

export async function GET(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiOk({ items: [] });
  }
  const { searchParams } = new URL(request.url);
  const repo = getCommerceRepository();
  const items = await repo.listPayments(session.tenant.id, {
    orderId: searchParams.get('orderId') ?? undefined,
    status: (searchParams.get('status') as 'PENDING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'CANCELLED' | undefined) ?? undefined,
    needsRecovery: searchParams.has('needsRecovery') ? searchParams.get('needsRecovery') === 'true' : undefined,
  });
  return apiOk({ items });
}
