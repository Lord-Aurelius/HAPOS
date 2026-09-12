import { apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { listCommerceSales } from '@/server/commerce/order-service';
import { toCommerceSession } from '@/app/api/v1/orders/route';

export async function GET() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  const commerce = toCommerceSession(session);
  if (!commerce) {
    return apiOk({ items: [] });
  }
  return apiOk({ items: await listCommerceSales(commerce) });
}
