import { apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { listAttendanceRecordsByTenant } from '@/server/store';

export async function GET() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return apiOk({ items: [] });
  }
  // Employees see their own records only; admins see the merchant view via
  // /records. The filter below is server-side, never a client parameter.
  const items = await listAttendanceRecordsByTenant(session.tenant.id, { employeeId: session.user.id });
  return apiOk({ items });
}
