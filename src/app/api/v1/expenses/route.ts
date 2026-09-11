import { apiBadRequest, apiCreated, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import {
  SaleValidationError,
  parseExpenseDateInput,
  parseMoneyInput,
  requireDisplayName,
} from '@/server/commerce/sale-validation';
import { listExpenses } from '@/server/services/app-data';
import { updateStore } from '@/server/store';
import { randomUUID } from 'node:crypto';

export async function GET() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  return apiOk({ items: session.tenant ? await listExpenses(session.tenant.id) : [] });
}

export async function POST(request: Request) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiCreated(null);
  }
  const body = await request.json();
  let category: string;
  let amount: number;
  let expenseDate: string;
  try {
    category = requireDisplayName(typeof body?.category === 'string' ? body.category : '', 'category');
    amount = parseMoneyInput(body?.amount, 'amount', 'invalid-amount');
    expenseDate = parseExpenseDateInput(body?.expenseDate);
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
      category,
      description: body.description,
      amount,
      expenseDate,
      createdBy: session.user.id,
      createdAt: new Date().toISOString(),
    };
    store.expenses.push(record);
    return record;
  });
  return apiCreated(created);
}
