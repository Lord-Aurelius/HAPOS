import { apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { listCustomers } from '@/server/services/app-data';
import { updateStore } from '@/server/store';

type RouteProps = {
  params: Promise<{ customerId: string }>;
};

export async function GET(_: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return apiOk(null);
  }
  const { customerId } = await params;
  const customer = (await listCustomers(session.tenant.id)).find((item) => item.id === customerId);

  return apiOk(customer ?? null);
}

export async function PATCH(request: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return apiOk(null);
  }
  const body = await request.json();
  const { customerId } = await params;
  const updated = await updateStore((store) => {
    const customer = store.customers.find((item) => item.id === customerId && item.tenantId === session.tenant!.id);
    if (!customer) {
      return null;
    }
    customer.name = body.name ?? customer.name;
    customer.phone = body.phone ?? customer.phone;
    customer.phoneE164 = body.phoneE164 ?? customer.phoneE164;
    customer.notes = body.notes ?? customer.notes;
    customer.marketingOptIn = body.marketingOptIn ?? customer.marketingOptIn;
    customer.updatedAt = new Date().toISOString();
    return customer;
  });
  return apiOk(updated);
}
