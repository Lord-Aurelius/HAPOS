import { apiBadRequest, apiNoContent, apiOk } from '@/server/http/api';
import { requireSession } from '@/server/auth/demo-session';
import {
  SaleValidationError,
  parseExpenseDateInput,
  parseMoneyInput,
} from '@/server/commerce/sale-validation';
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
  // Provided fields are validated strictly; absent fields keep their values.
  try {
    if (body?.amount !== undefined && body?.amount !== null && String(body.amount).trim() !== '') {
      parseMoneyInput(body.amount, 'amount', 'invalid-amount');
    } else if (body?.amount !== undefined) {
      return apiBadRequest('amount must be a valid amount.');
    }
    if (body?.expenseDate !== undefined && body?.expenseDate !== null) {
      parseExpenseDateInput(body.expenseDate);
    }
    if (body?.category !== undefined && body?.category !== null && typeof body.category === 'string' && !body.category.trim()) {
      return apiBadRequest('category is required.');
    }
  } catch (error) {
    if (error instanceof SaleValidationError) {
      return apiBadRequest(error.message);
    }
    throw error;
  }
  const updated = await updateStore((store) => {
    const expense = store.expenses.find((item) => item.id === expenseId && item.tenantId === session.tenant!.id);
    if (!expense) {
      return null;
    }
    expense.category = body.category ?? expense.category;
    expense.description = body.description ?? expense.description;
    expense.amount =
      body.amount !== undefined && body.amount !== null && String(body.amount).trim() !== ''
        ? Number(body.amount)
        : expense.amount;
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
