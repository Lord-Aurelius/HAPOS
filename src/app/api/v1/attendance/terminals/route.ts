import { NextResponse } from 'next/server';

import { apiBadRequest, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { AttendanceError } from '@/server/commerce/attendance';
import { rotateTerminal, setTerminalActive, type AttendanceStore } from '@/server/commerce/attendance-store';
import { listAttendanceTerminalsByTenant, updateStore } from '@/server/store';
import type { StoreState } from '@/server/store/types';

export async function GET() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiOk({ items: [] });
  }
  return apiOk({ items: await listAttendanceTerminalsByTenant(session.tenant.id) });
}

/** Rotate the merchant terminal. Returns the one-time bearer for QR render. */
export async function POST() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiBadRequest('Tenant context is required.', 400);
  }
  const tenantId = session.tenant.id;
  const tenantSlug = session.tenant.slug;
  const userId = session.user.id;

  const result = await updateStore((store) => {
    const rotated = rotateTerminal(store as unknown as AttendanceStore, {
      tenantId,
      createdBy: userId,
      shopSlug: tenantSlug,
    });
    return { reference: rotated.terminal.reference, token: rotated.token };
  });
  return NextResponse.json(result, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiBadRequest('Tenant context is required.', 400);
  }
  const body = await request.json().catch(() => null);
  if (typeof body?.isActive !== 'boolean') {
    return apiBadRequest('isActive must be a boolean.');
  }

  try {
    await updateStore((store: StoreState) => {
      setTerminalActive(store as unknown as AttendanceStore, {
        tenantId: session.tenant!.id,
        isActive: body.isActive,
      });
    });
    return apiOk({ ok: true });
  } catch (error) {
    if (error instanceof AttendanceError) {
      return apiBadRequest(error.message);
    }
    throw error;
  }
}
