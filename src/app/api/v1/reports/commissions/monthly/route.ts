import { apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { getStaffPerformance } from '@/server/services/app-data';

export async function GET() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  return apiOk({ items: session.tenant ? await getStaffPerformance(session.tenant.id) : [] });
}
