import { randomUUID } from 'node:crypto';

import { parseDateTimeInputValue } from '@/lib/date-time';
import { apiBadRequest, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { calculateCommission, listServiceRecords } from '@/server/services/app-data';
import { voidServiceRecord } from '@/server/store/service-records';
import { updateStore } from '@/server/store';
import type { StoreState } from '@/server/store/types';

function upsertTenantCustomer(
  store: StoreState,
  input: { tenantId: string; customerName: string; customerPhone: string },
) {
  const now = new Date().toISOString();
  let customer = store.customers.find(
    (item) => item.tenantId === input.tenantId && item.phoneE164 === input.customerPhone,
  );

  if (!customer) {
    customer = {
      id: randomUUID(),
      tenantId: input.tenantId,
      name: input.customerName,
      phone: input.customerPhone,
      phoneE164: input.customerPhone,
      marketingOptIn: true,
      createdAt: now,
      updatedAt: now,
    };
    store.customers.push(customer);
  } else {
    customer.name = input.customerName || customer.name;
    customer.phone = input.customerPhone || customer.phone;
    customer.phoneE164 = input.customerPhone || customer.phoneE164;
    customer.updatedAt = now;
  }

  return customer;
}

function buildProductUsages(store: StoreState, tenantId: string, productId: string | null, productQuantity: number) {
  if (!productId || productQuantity <= 0) {
    return [];
  }

  const product = store.products.find((item) => item.tenantId === tenantId && item.id === productId);
  return product ? [{ productId, quantity: productQuantity, unitCost: product.unitCost }] : [];
}

type RouteProps = {
  params: Promise<{ recordId: string }>;
};

export async function GET(_: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return apiBadRequest('Tenant context is required.', 400);
  }

  const { recordId } = await params;
  const records = await listServiceRecords(session.tenant.id);
  const record = records.find((item) => item.id === recordId);

  if (!record) {
    return apiBadRequest('Service record not found.', 404);
  }

  if (session.user.role === 'staff' && record.staffId !== session.user.id) {
    return apiBadRequest('You can only view your own service records.', 403);
  }

  return apiOk(record);
}

export async function PATCH(request: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiBadRequest('Tenant context is required.', 400);
  }

  const { recordId } = await params;
  const body = await request.json();
  const serviceMode = body.serviceMode === 'custom' ? 'custom' : 'price-list';
  const timeZone =
    typeof body?.timeZone === 'string' && body.timeZone.trim()
      ? body.timeZone.trim()
      : session.tenant.timezone || 'UTC';
  const performedAt =
    typeof body.performedAt === 'string' && body.performedAt.trim()
      ? parseDateTimeInputValue(body.performedAt, timeZone)
      : null;

  if (body.performedAt && !performedAt) {
    return apiBadRequest('performedAt must be a valid ISO date-time or datetime-local value.');
  }

  if (
    serviceMode === 'custom' &&
    ((typeof body.customServiceName !== 'string' || !body.customServiceName.trim()) || Number(body.customPrice) <= 0)
  ) {
    return apiBadRequest('Custom services require a name and positive price.');
  }

  try {
    const updatedRecord = await updateStore((store) => {
      const record = store.serviceRecords.find((item) => item.id === recordId && item.tenantId === session.tenant!.id);
      if (!record) {
        throw new Error('Service record not found.');
      }
      if (record.voidedAt) {
        throw new Error('This sale has already been removed from the ledger.');
      }

      const tenantId = session.tenant!.id;
      const tenantUsers = store.users.filter((user) => user.tenantId === tenantId);
      const tenantServices = store.services.filter((service) => service.tenantId === tenantId);

      const staff = tenantUsers.find((user) => user.id === body.staffId);
      if (!staff) {
        throw new Error('Staff member not found.');
      }

      const service =
        serviceMode === 'price-list' ? tenantServices.find((item) => item.id === body.serviceId) ?? null : null;
      if (serviceMode === 'price-list' && !service) {
        throw new Error('Selected service is not available for this tenant.');
      }

      const customer =
        typeof body.customerPhone === 'string' && body.customerPhone.trim()
          ? upsertTenantCustomer(store, {
              tenantId,
              customerName: String(body.customerName ?? '').trim(),
              customerPhone: body.customerPhone.trim(),
            })
          : store.customers.find((item) => item.id === record.customerId && item.tenantId === tenantId);

      if (!customer) {
        throw new Error('Customer not found.');
      }

      const price = service ? service.price : Number(body.customPrice);
      const commission = calculateCommission({
        service: service ? { commissionType: service.commissionType, commissionValue: service.commissionValue } : null,
        staff: { commissionType: staff.commissionType, commissionValue: staff.commissionValue },
        price,
      });

      record.customerId = customer.id;
      record.staffId = staff.id;
      record.serviceId = service?.id ?? null;
      record.serviceName = service ? service.name : String(body.customServiceName ?? '').trim();
      record.isCustomService = !service;
      record.price = price;
      record.description = typeof body.description === 'string' ? body.description.trim() : '';
      record.commissionType = commission.commissionType;
      record.commissionValue = commission.commissionValue;
      record.commissionAmount = commission.commissionAmount;
      record.productUsages = buildProductUsages(
        store,
        tenantId,
        typeof body.productId === 'string' ? body.productId : null,
        Number(body.productQuantity ?? 0),
      );
      record.performedAt = performedAt ?? record.performedAt;
      record.correctedAt = new Date().toISOString();
      record.correctedBy = session.user.id;

      const users = store.users;
      const customers = store.customers;
      const products = store.products;

      return {
        id: record.id,
        tenantId: record.tenantId,
        customerId: record.customerId,
        staffId: record.staffId,
        serviceId: record.serviceId,
        price: record.price,
        description: record.description,
        commission: record.commissionAmount,
        performedAt: record.performedAt,
        customerName: customers.find((item) => item.id === record.customerId)?.name,
        serviceName: record.serviceName,
        staffName: users.find((item) => item.id === record.staffId)?.fullName,
        isCustomService: record.isCustomService,
        productUsages: record.productUsages.map((usage) => ({
          productId: usage.productId,
          productName: products.find((item) => item.id === usage.productId)?.name ?? 'Unknown product',
          quantity: usage.quantity,
          unitCost: usage.unitCost,
          totalCost: usage.quantity * usage.unitCost,
        })),
        correctedAt: record.correctedAt,
        correctedBy: record.correctedBy,
        correctedByName: record.correctedBy ? users.find((item) => item.id === record.correctedBy)?.fullName ?? null : null,
        voidedAt: record.voidedAt,
        voidedBy: record.voidedBy,
        voidedByName: record.voidedBy ? users.find((item) => item.id === record.voidedBy)?.fullName ?? null : null,
        voidReason: record.voidReason,
      };
    });

    return apiOk(updatedRecord);
  } catch (error) {
    return apiBadRequest(error instanceof Error ? error.message : 'Could not update service record.', 400);
  }
}

export async function DELETE(request: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiBadRequest('Tenant context is required.', 400);
  }

  const { recordId } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: string } | null;

  const result = await updateStore((store) =>
    voidServiceRecord(store, {
      tenantId: session.tenant!.id,
      recordId,
      userId: session.user.id,
      reason: body?.reason ?? 'Duplicate or mistaken sale entry removed from the ledger.',
    }),
  );

  if (result.status === 'missing') {
    return apiBadRequest('Service record not found.', 404);
  }

  return apiOk({
    recordId,
    nextRecordId: result.nextRecordId,
    restoredOrderId: result.restoredOrderId,
  });
}
