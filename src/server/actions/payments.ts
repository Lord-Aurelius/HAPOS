'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireSession } from '@/server/auth/demo-session';
import { getCommerceRepository } from '@/server/commerce/repository-select';
import { toServiceError } from '@/server/commerce/order-service';
import { PaymentConnectionError } from '@/server/payments/connection';
import {
  expireOverduePayments,
  getCallbackBaseUrl,
  getPaymentGateway,
  reconcileStalePendingPayments,
  retryMpesaPayment,
} from '@/server/payments/payment-service';

function formString(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function failureRedirect(base: string, error: unknown): never {
  let code = 'payment-failed';
  try {
    code = toServiceError(error).code;
  } catch {
    throw error;
  }
  redirect(`${base}${base.includes('?') ? '&' : '?'}error=${code}`);
}

/** Admin: request a fresh M-Pesa attempt on a held/failed order. */
export async function retryOrderPaymentAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  const orderId = formString(formData, 'orderId');

  try {
    const repo = getCommerceRepository();
    await retryMpesaPayment(repo, getPaymentGateway(), {
      tenantId: session.tenant.id,
      orderId,
      actorId: session.user.id,
      callbackBaseUrl: getCallbackBaseUrl(),
    });
    revalidatePath('/app/orders');
    redirect(`/app/orders?orderId=${orderId}&success=payment-requested`);
  } catch (error) {
    failureRedirect(`/app/orders?orderId=${orderId}`, error);
  }
}

/** Admin: retry completion for a SUCCESS payment flagged needs_recovery. */
export async function recoverPaidOrderAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  const paymentId = formString(formData, 'paymentId');
  const orderId = formString(formData, 'orderId');

  try {
    const repo = getCommerceRepository();
    await repo.recoverPaidOrder({ tenantId: session.tenant.id, paymentId, actorId: session.user.id });
    revalidatePath('/app/orders');
    redirect(`/app/orders?orderId=${orderId}&success=recovery-completed`);
  } catch (error) {
    failureRedirect(`/app/orders?orderId=${orderId}`, error);
  }
}

/** Admin: expire overdue PENDING intents for their tenant. */
export async function expireOverduePaymentsAction() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  const repo = getCommerceRepository();
  const expired = await expireOverduePayments(repo, { tenantId: session.tenant.id });
  revalidatePath('/app/orders');
  redirect(`/app/orders?success=expiry-swept&count=${expired}`);
}

/**
 * Admin: poll PaymentOS directly for stale PENDING intents (missed-webhook
 * convergence). Returns per-payment outcomes as a compact summary code.
 */
export async function reconcilePendingPaymentsAction() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  const repo = getCommerceRepository();
  try {
    const outcomes = await reconcileStalePendingPayments(repo, {
      tenantId: session.tenant.id,
      actorId: session.user.id,
    });
    const completed = outcomes.filter((o) => o.outcome === 'completed').length;
    const failed = outcomes.filter((o) => o.outcome === 'failed' || o.outcome === 'expired' || o.outcome === 'failed-held').length;
    const pending = outcomes.filter((o) => o.outcome === 'still-pending' || o.outcome === 'skipped').length;
    revalidatePath('/app/orders');
    redirect(`/app/orders?success=reconciliation-run&completed=${completed}&failed=${failed}&pending=${pending}`);
  } catch (error) {
    const code = error instanceof PaymentConnectionError ? error.code : 'reconciliation-failed';
    redirect(`/app/orders?error=${code}`);
  }
}
