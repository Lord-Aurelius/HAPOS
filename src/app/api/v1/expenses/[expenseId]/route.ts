import { apiNoContent, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import { updateStore } from '@/server/store';

type RouteProps = {
  params: Promise<{ expenseId: string }>;
};

export async function PATCH(request: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiOk(null);
  }
  const body = await request.json();
  const { expenseId } = await params;
  const updated = await updateStore((store) => {
    const expense = store.expenses.find((item) => item.id === expenseId && item.tenantId === session.tenant!.id);
    if (!expense) {
      return null;
    }
    expense.category = body.category ?? expense.category;
    expense.description = body.description ?? expense.description;
    expense.amount = body.amount ? Number(body.amount) : expense.amount;
    expense.expenseDate = body.expenseDate ?? expense.expenseDate;
    return expense;
  });
  return apiOk(updated);
}

export async function DELETE(_: Request, { params }: RouteProps) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    return apiNoContent();
  }
  const { expenseId } = await params;
  await updateStore((store) => {
    store.expenses = store.expenses.filter(
      (item) => !(item.id === expenseId && item.tenantId === session.tenant!.id),
    );
  });
  await params;
  return apiNoContent();
}
