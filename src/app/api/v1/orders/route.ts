import { apiBadRequest, apiCreated, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { serviceErrorResponse, toCommerceSession } from '@/server/http/commerce-api';
import {
  createAndSubmitOrder,
  listCommerceOrders,
  parseCartLines,
} from '@/server/commerce/order-service';

export async function GET() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  const commerce = toCommerceSession(session);
  if (!commerce) {
    return apiOk({ items: [] });
  }
  return apiOk({ items: await listCommerceOrders(commerce) });
}

export async function POST(request: Request) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  const commerce = toCommerceSession(session);
  if (!commerce) {
    return apiBadRequest('Tenant context is required.', 400);
  }

  const body = await request.json().catch(() => null);
  try {
    const created = await createAndSubmitOrder(commerce, {
      customerId: typeof body?.customerId === 'string' ? body.customerId : null,
      lines: parseCartLines(body?.lines),
      clientTotal:
        body?.clientTotal === undefined || body?.clientTotal === null ? null : Number(body.clientTotal),
      notes: typeof body?.notes === 'string' ? body.notes : null,
      idempotencyKey: body?.idempotencyKey ?? null,
    });
    return apiCreated(created);
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
