import { NextResponse } from 'next/server';

import { apiBadRequest, apiCreated, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import {
  createAndSubmitOrder,
  listCommerceOrders,
  parseCartLines,
  toServiceError,
  type CommerceSession,
} from '@/server/commerce/order-service';

export function toCommerceSession(session: {
  tenant: { id: string } | null;
  user: { id: string; role: CommerceSession['userRole'] };
}): CommerceSession | null {
  if (!session.tenant) {
    return null;
  }
  return { tenantId: session.tenant.id, userId: session.user.id, userRole: session.user.role };
}

export function serviceErrorResponse(error: unknown) {
  try {
    const mapped = toServiceError(error);
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  } catch {
    throw error;
  }
}

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
