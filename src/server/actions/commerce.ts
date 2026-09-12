'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireSession } from '@/server/auth/demo-session';
import { CartFormError, parseCartFormEntries } from '@/server/commerce/cart-form';
import {
  approveCommerceOrder,
  cancelCommerceOrder,
  createAndSubmitOrder,
  rejectCommerceOrder,
  toServiceError,
  voidCommerceSale,
  type CommerceSession,
} from '@/server/commerce/order-service';
import type { CartLineRequest } from '@/server/commerce/orders';

function formString(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function commerceSessionOf(session: {
  tenant: { id: string } | null;
  user: { id: string; role: CommerceSession['userRole'] };
}): CommerceSession {
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  return { tenantId: session.tenant.id, userId: session.user.id, userRole: session.user.role };
}

function failureRedirect(orderId: string | null, error: unknown) {
  let code = 'order-failed';
  try {
    code = toServiceError(error).code;
  } catch {
    throw error;
  }
  redirect(orderId ? `/app/orders?orderId=${orderId}&error=${code}` : `/app/orders?error=${code}`);
}

/** Parse the 4 no-JS cart rows via the shared normalizer (skips blank items). */
function parseFormCart(formData: FormData): CartLineRequest[] {
  return parseCartFormEntries(formData.entries());
}

export async function createCommerceOrderAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  const commerce = commerceSessionOf(session);

  try {
    const created = await createAndSubmitOrder(commerce, {
      customerId: formString(formData, 'customerId') || null,
      lines: parseFormCart(formData),
      notes: formString(formData, 'notes') || null,
      idempotencyKey: formString(formData, 'idempotencyKey') || null,
    });
    revalidatePath('/app/orders');
    redirect(`/app/orders?orderId=${created.order.id}&success=${created.duplicate ? 'order-duplicate' : 'order-created'}`);
  } catch (error) {
    failureRedirect(null, error);
  }
}

export async function approveCommerceOrderAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  const commerce = commerceSessionOf(session);
  const orderId = formString(formData, 'orderId');

  try {
    const result = await approveCommerceOrder(commerce, orderId);
    revalidatePath('/app/orders');
    redirect(`/app/orders?orderId=${orderId}&success=${result.duplicate ? 'order-duplicate' : 'order-approved'}`);
  } catch (error) {
    failureRedirect(orderId, error);
  }
}

export async function rejectCommerceOrderAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  const commerce = commerceSessionOf(session);
  const orderId = formString(formData, 'orderId');

  try {
    await rejectCommerceOrder(commerce, orderId, formString(formData, 'reason') || null);
    revalidatePath('/app/orders');
    redirect(`/app/orders?orderId=${orderId}&success=order-rejected`);
  } catch (error) {
    failureRedirect(orderId, error);
  }
}

export async function cancelCommerceOrderAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  const commerce = commerceSessionOf(session);
  const orderId = formString(formData, 'orderId');

  try {
    await cancelCommerceOrder(commerce, orderId);
    revalidatePath('/app/orders');
    redirect(`/app/orders?orderId=${orderId}&success=order-cancelled`);
  } catch (error) {
    failureRedirect(orderId, error);
  }
}

export async function voidCommerceSaleAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  const commerce = commerceSessionOf(session);
  const saleId = formString(formData, 'saleId');

  try {
    await voidCommerceSale(commerce, saleId, formString(formData, 'reason') || null);
    revalidatePath('/app/orders');
    redirect(`/app/orders?saleId=${saleId}&success=sale-voided`);
  } catch (error) {
    let code = 'order-failed';
    try {
      code = toServiceError(error).code;
    } catch {
      throw error;
    }
    redirect(`/app/orders?saleId=${saleId}&error=${code}`);
  }
}
