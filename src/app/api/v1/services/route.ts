import { apiBadRequest, apiCreated, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import {
  SaleValidationError,
  parseMoneyInput,
  parseOptionalMoneyInput,
  parseProductQuantityInput,
  requireDisplayName,
} from '@/server/commerce/sale-validation';
import { listServices } from '@/server/services/app-data';
import { updateStore } from '@/server/store';
import { randomUUID } from 'node:crypto';

export async function GET() {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  return apiOk({ items: session.tenant ? await listServices(session.tenant.id) : [] });
}

export async function POST(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiCreated(null);
  }
  const body = await request.json();
  const commissionType: 'fixed' | 'percentage' = body.commissionType === 'fixed' ? 'fixed' : 'percentage';
  let name: string;
  let price: number;
  let commissionValue: number;
  let durationMinutes: number | undefined;
  try {
    name = requireDisplayName(typeof body?.name === 'string' ? body.name : '', 'name');
    price = parseMoneyInput(body?.price, 'price');
    commissionValue = parseOptionalMoneyInput(body?.commissionValue ?? 0, 'commissionValue') ?? 0;
    const durationRaw = body?.durationMinutes;
    const durationParsed =
      durationRaw === undefined || durationRaw === null || String(durationRaw).trim() === ''
        ? 0
        : parseProductQuantityInput(durationRaw, 'durationMinutes');
    durationMinutes = durationParsed > 0 ? durationParsed : undefined;
  } catch (error) {
    if (error instanceof SaleValidationError) {
      return apiBadRequest(error.message);
    }
    throw error;
  }
  const created = await updateStore((store) => {
    const record = {
      id: randomUUID(),
      tenantId: session.tenant!.id,
      name,
      price,
      description: body.description,
      commissionType,
      commissionValue,
      durationMinutes,
      isActive: body.isActive ?? true,
      createdBy: session.user.id,
      updatedBy: session.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    store.services.push(record);
    return record;
  });
  return apiCreated(created);
}
