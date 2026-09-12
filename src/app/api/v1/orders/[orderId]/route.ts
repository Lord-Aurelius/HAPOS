import { apiBadRequest, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { getCommerceOrder } from '@/server/commerce/order-service';
import { toCommerceSession } from '@/app/api/v1/orders/route';

type RouteProps = {
  params: Promise<{ orderId: string }>;
};

export async function GET(_: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  const commerce = toCommerceSession(session);
  if (!commerce) {
    return apiBadRequest('Tenant context is required.', 400);
  }
  const { orderId } = await params;
  const order = await getCommerceOrder(commerce, orderId);
  if (!order) {
    return apiBadRequest('Order not found.', 404);
  }
  return apiOk(order);
}
