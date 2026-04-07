import { apiCreated, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
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
  const created = await updateStore((store) => {
    const record = {
      id: randomUUID(),
      tenantId: session.tenant!.id,
      category: body.category,
      description: body.description,
      amount: Number(body.amount),
      expenseDate: body.expenseDate,
      createdBy: session.user.id,
      createdAt: new Date().toISOString(),
    };
    store.expenses.push(record);
    return record;
  });
  return apiCreated(created);
}
