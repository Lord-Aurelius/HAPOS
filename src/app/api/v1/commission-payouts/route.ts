import { apiBadRequest, apiCreated, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { listCommissionPayouts } from '@/server/services/app-data';
import { readStore, updateStore } from '@/server/store';
import { randomUUID } from 'node:crypto';

export async function GET() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  return apiOk({ items: session.tenant ? await listCommissionPayouts(session.tenant.id) : [] });
}

export async function POST(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiCreated(null);
  }
  const body = await request.json();
  const store = await readStore();
  const staff = store.users.find(
    (user) =>
      user.id === body.staffId &&
      user.tenantId === session.tenant!.id &&
      (user.role === 'staff' || user.role === 'shop_admin'),
  );

  if (!staff) {
    return apiBadRequest('Staff member not found for this tenant.');
  }

  const created = await updateStore((store) => {
    const record = {
      id: randomUUID(),
      tenantId: session.tenant!.id,
      staffId: staff.id,
      amount: Number(body.amount),
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      paidAt: body.paidAt ?? null,
      createdAt: new Date().toISOString(),
    };
    store.commissionPayouts.push(record);
    return record;
  });
  return apiCreated(created);
}
