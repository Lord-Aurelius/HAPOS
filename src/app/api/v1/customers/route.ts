import { apiBadRequest, apiCreated, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { listCustomers } from '@/server/services/app-data';
import { updateStore } from '@/server/store';
import { randomUUID } from 'node:crypto';

function normalizePhoneInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('+')) {
    return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  }

  return trimmed.replace(/\D/g, '');
}

function normalizePhoneLookup(value: string) {
  return value.replace(/\D/g, '');
}

export async function GET() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  return apiOk({ items: session.tenant ? await listCustomers(session.tenant.id) : [] });
}

export async function POST(request: Request) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    return apiCreated(null);
  }
  const body = await request.json();
  const name = String(body?.name ?? '').trim();
  const phone = normalizePhoneInput(String(body?.phoneE164 ?? body?.phone ?? ''));
  if (!name || !phone) {
    return apiBadRequest('Customer name and phone are required.');
  }

  const created = await updateStore((store) => {
    const existing = store.customers.find(
      (customer) =>
        customer.tenantId === session.tenant!.id &&
        normalizePhoneLookup(customer.phoneE164 || customer.phone) === normalizePhoneLookup(phone),
    );

    if (existing && !existing.archivedAt) {
      return existing;
    }

    const now = new Date().toISOString();
    if (existing && existing.archivedAt) {
      existing.name = name;
      existing.phone = phone;
      existing.phoneE164 = phone;
      existing.notes = body.notes;
      existing.marketingOptIn = body.marketingOptIn ?? true;
      existing.archivedAt = null;
      existing.updatedAt = now;
      return existing;
    }

    const record = {
      id: randomUUID(),
      tenantId: session.tenant!.id,
      name,
      phone,
      phoneE164: phone,
      notes: body.notes,
      marketingOptIn: body.marketingOptIn ?? true,
      createdAt: now,
      updatedAt: now,
    };
    store.customers.push(record);
    return record;
  });
  return apiCreated(created);
}
