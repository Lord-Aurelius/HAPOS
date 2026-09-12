import { apiBadRequest, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { approveCommerceOrder } from '@/server/commerce/order-service';
import { serviceErrorResponse, toCommerceSession } from '@/server/http/commerce-api';

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
    // Staff callers receive 403 from the domain layer when the order needs
    // admin approval; no role is trusted client-side.
    return apiOk(await approveCommerceOrder(commerce, orderId));
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
