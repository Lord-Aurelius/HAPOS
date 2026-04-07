import { randomUUID } from 'node:crypto';

import { apiBadRequest, apiCreated, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { calculateCommission, listServiceRecords } from '@/server/services/app-data';
import { dispatchSmsLogs } from '@/server/services/sms';
import { updateStore } from '@/server/store';

export async function GET() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return apiOk({ items: [] });
  }

  const items = await listServiceRecords(session.tenant.id);
  return apiOk({
    items: session.user.role === 'staff' ? items.filter((record) => record.staffId === session.user.id) : items,
  });
}

export async function POST(request: Request) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return apiCreated(null);
  }
  const body = await request.json();
  const result = await updateStore((store) => {
    const requestedStaffId = session.user.role === 'staff' ? session.user.id : String(body?.staffId ?? '');
    const staff = store.users.find(
      (item) =>
        item.id === requestedStaffId &&
        item.tenantId === session.tenant!.id &&
        (item.role === 'staff' || item.role === 'shop_admin'),
    );
    if (!staff) {
      return { ok: false as const, error: 'Staff member not found for this tenant.' };
    }

    const service =
      body.serviceId
        ? store.services.find(
            (item) => item.id === body.serviceId && item.tenantId === session.tenant!.id && item.isActive,
          ) ?? null
        : null;
    if (body.serviceId && !service) {
      return { ok: false as const, error: 'Selected service is not available for this tenant.' };
    }

    const customer = store.customers.find(
      (item) => item.id === body.customerId && item.tenantId === session.tenant!.id,
    );
    if (!customer) {
      return { ok: false as const, error: 'Customer not found for this tenant.' };
    }

    const commission = calculateCommission({
      service: service ? { commissionType: service.commissionType, commissionValue: service.commissionValue } : null,
      staff: { commissionType: staff.commissionType, commissionValue: staff.commissionValue },
      price: Number(body.price),
    });
    const record = {
      id: randomUUID(),
      tenantId: session.tenant!.id,
      customerId: body.customerId,
      staffId: staff.id,
      serviceId: body.serviceId ?? null,
      serviceName: body.serviceName ?? service?.name ?? 'Custom service',
      isCustomService: !body.serviceId,
      price: Number(body.price),
      description: body.description,
      commissionType: commission.commissionType,
      commissionValue: commission.commissionValue,
      commissionAmount: commission.commissionAmount,
      productUsages: [],
      performedAt: body.performedAt ?? new Date().toISOString(),
      recordedBy: session.user.id,
      correctedAt: null,
      correctedBy: null,
      createdAt: new Date().toISOString(),
    };
    store.serviceRecords.push(record);

    let smsId: string | null = null;
    if (customer) {
      smsId = randomUUID();
      store.smsLogs.push({
        id: smsId,
        tenantId: session.tenant!.id,
        customerId: customer.id,
        smsType: 'thank_you',
        recipientPhone: customer.phoneE164,
        message: `Thank you for visiting ${session.tenant!.name}, ${customer.name}.`,
        status: 'queued',
        createdAt: new Date().toISOString(),
      });
    }

    return { ok: true as const, record, smsIds: smsId ? [smsId] : [] };
  });

  if (!result.ok) {
    return apiBadRequest(result.error);
  }

  await dispatchSmsLogs(result.smsIds);
  return apiCreated(result.record);
}
