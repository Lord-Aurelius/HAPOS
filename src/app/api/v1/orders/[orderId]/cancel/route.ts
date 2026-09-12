import { apiBadRequest, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { cancelCommerceOrder } from '@/server/commerce/order-service';
import { serviceErrorResponse, toCommerceSession } from '@/app/api/v1/orders/route';

type RouteProps = {
  params: Promise<{ orderId: string }>;
};

export async function POST(_: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  const commerce = toCommerceSession(session);
  if (!commerce) {
    return apiBadRequest('Tenant context is required.', 400);
  }
  const { orderId } = await params;
  try {
    return apiOk(await cancelCommerceOrder(commerce, orderId));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
