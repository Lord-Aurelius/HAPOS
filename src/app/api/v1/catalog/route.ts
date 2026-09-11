import { apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { getCatalog } from '@/server/services/app-data';

export async function GET() {
  // Sellers (staff) may read the active catalog; full inventory detail stays
  // on admin surfaces. Inactive items are excluded by default.
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return apiOk({ items: [] });
  }

  const items = await getCatalog(session.tenant.id);
  return apiOk({ items });
}
