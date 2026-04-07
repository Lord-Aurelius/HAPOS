import { apiNoContent, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { listServices } from '@/server/services/app-data';
import { updateStore } from '@/server/store';

type RouteProps = {
  params: Promise<{ serviceId: string }>;
};

export async function PATCH(request: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiOk(null);
  }
  const body = await request.json();
  const { serviceId } = await params;
  const updated = await updateStore((store) => {
    const service = store.services.find((item) => item.id === serviceId && item.tenantId === session.tenant!.id);
    if (!service) {
      return null;
    }
    service.name = body.name ?? service.name;
    service.price = body.price ? Number(body.price) : service.price;
    service.description = body.description ?? service.description;
    service.commissionType = body.commissionType === 'fixed' ? 'fixed' : service.commissionType;
    service.commissionValue = body.commissionValue ? Number(body.commissionValue) : service.commissionValue;
    service.updatedAt = new Date().toISOString();
    return service;
  });
  return apiOk(updated);
}

export async function DELETE(_: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiNoContent();
  }
  const { serviceId } = await params;
  const service = (await listServices(session.tenant.id)).find((item) => item.id === serviceId);

  if (!service) {
    return apiNoContent();
  }

  await updateStore((store) => {
    const target = store.services.find((item) => item.id === serviceId && item.tenantId === session.tenant!.id);
    if (target) {
      target.isActive = false;
      target.updatedAt = new Date().toISOString();
    }
  });

  return apiNoContent();
}
