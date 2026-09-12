import { NextResponse } from 'next/server';

import { toServiceError, type CommerceSession } from '@/server/commerce/order-service';

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
