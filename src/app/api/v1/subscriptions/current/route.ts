import { apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { getCurrentSubscription } from '@/server/services/app-data';

export async function GET() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  return apiOk(session.tenant ? await getCurrentSubscription(session.tenant.id) : null);
}
