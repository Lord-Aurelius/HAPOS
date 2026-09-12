import { apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { listAttendanceRecordsByTenant } from '@/server/store';

export async function GET(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiOk({ items: [] });
  }
  const { searchParams } = new URL(request.url);
  const items = await listAttendanceRecordsByTenant(session.tenant.id, {
    attendanceDate: searchParams.get('date') ?? undefined,
    employeeId: searchParams.get('employeeId') ?? undefined,
    status: searchParams.get('status') ?? undefined,
  });
  return apiOk({ items });
}
