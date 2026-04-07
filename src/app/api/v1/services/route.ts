import { apiCreated, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { listServices } from '@/server/services/app-data';
import { updateStore } from '@/server/store';
import { randomUUID } from 'node:crypto';

export async function GET() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  return apiOk({ items: session.tenant ? await listServices(session.tenant.id) : [] });
}

export async function POST(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiCreated(null);
  }
  const body = await request.json();
  const commissionType: 'fixed' | 'percentage' = body.commissionType === 'fixed' ? 'fixed' : 'percentage';
  const created = await updateStore((store) => {
    const record = {
      id: randomUUID(),
      tenantId: session.tenant!.id,
      name: body.name,
      price: Number(body.price),
      description: body.description,
      commissionType,
      commissionValue: Number(body.commissionValue ?? 0),
      durationMinutes: body.durationMinutes ? Number(body.durationMinutes) : undefined,
      isActive: body.isActive ?? true,
      createdBy: session.user.id,
      updatedBy: session.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.services.push(record);
    return record;
  });
  return apiCreated(created);
}
