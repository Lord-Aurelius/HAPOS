import { randomUUID } from 'node:crypto';

import { apiBadRequest, apiCreated, apiOk } from '@/server/http/api';
import { parseDateTimeInputValue } from '@/lib/date-time';
import { requireSession } from '@/server/auth/demo-session';
import {
  IdempotencyKeyError,
  findExistingSaleRecord,
  normalizeIdempotencyKey,
} from '@/server/commerce/idempotency';
import { SaleValidationError, parseMoneyInput, requireDisplayName } from '@/server/commerce/sale-validation';
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
  const timeZone =
    typeof body?.timeZone === 'string' && body.timeZone.trim()
      ? body.timeZone.trim()
      : session.tenant.timezone || 'UTC';
  const performedAt =
    typeof body?.performedAt === 'string' && body.performedAt.trim()
      ? parseDateTimeInputValue(body.performedAt, timeZone)
      : null;

  if (body?.performedAt && !performedAt) {
    return apiBadRequest('performedAt must be a valid ISO date-time or datetime-local value.');
  }

  let price: number;
  try {
    price = parseMoneyInput(body?.price, 'price');
    if (!body?.serviceId) {
      requireDisplayName(typeof body?.serviceName === 'string' ? body.serviceName : '', 'serviceName');
      if (price <= 0) {
        return apiBadRequest('Custom services require a name and positive price.');
      }
    }
  } catch (error) {
    if (error instanceof SaleValidationError) {
      return apiBadRequest(error.message);
    }
    throw error;
  }

  let requestedIdempotencyKey: string | null = null;
  try {
    requestedIdempotencyKey = normalizeIdempotencyKey(body?.idempotencyKey);
  } catch (error) {
    if (error instanceof IdempotencyKeyError) {
      return apiBadRequest(error.message);
    }
    throw error;
  }

  const result = await updateStore((store) => {
    // Exactly-once claim inside the atomic mutator (see recordServiceAction).
    const duplicate = findExistingSaleRecord(store.serviceRecords, session.tenant!.id, requestedIdempotencyKey);
    if (duplicate) {
      return { ok: true as const, record: duplicate, smsIds: [] as string[], duplicate: true as const };
    }

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
      price,
    });
    const record = {
      id: randomUUID(),
      tenantId: session.tenant!.id,
      customerId: body.customerId,
      staffId: staff.id,
      serviceId: body.serviceId ?? null,
      serviceName: typeof body.serviceName === 'string' && body.serviceName.trim() ? body.serviceName.trim() : (service?.name ?? 'Custom service'),
      isCustomService: !body.serviceId,
      price,
      description: body.description,
      commissionType: commission.commissionType,
      commissionValue: commission.commissionValue,
      commissionAmount: commission.commissionAmount,
      productUsages: [],
      performedAt: performedAt ?? new Date().toISOString(),
      recordedBy: session.user.id,
      correctedAt: null,
      correctedBy: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      idempotencyKey: requestedIdempotencyKey ?? randomUUID(),
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

    return { ok: true as const, record, smsIds: smsId ? [smsId] : [], duplicate: false as const };
  });

  if (!result.ok) {
    return apiBadRequest(result.error);
  }

  await dispatchSmsLogs(result.smsIds);
  // Retried keys return the original record with 200 (not a second 201).
  if (result.duplicate) {
    return apiOk(result.record);
  }
  return apiCreated(result.record);
}
