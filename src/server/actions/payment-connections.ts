'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireSession } from '@/server/auth/demo-session';
import { getCommerceRepository } from '@/server/commerce/repository-select';
import {
  connectPaymentOS,
  disconnectConnection,
  rotateConnectionCredentials,
  verifyConnection,
} from '@/server/payments/connection-service';

/**
 * Shop-admin payment connection management (Phase 4B).
 *
 * Ownership: the tenant ALWAYS comes from the authenticated session — never
 * from form input — so a shop admin can only manage their own shop's
 * connection. Super admins without a tenant context are redirected to the
 * platform area. Every outcome redirects back to /app/settings/payments
 * with a non-sensitive message; provider secrets are never echoed.
 */

function formString(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function toQuery(base: string, params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

export async function connectPaymentOSAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  const tenantId = session.tenant.id;
  const raw = {
    providerTenantId: formString(formData, 'providerTenantId'),
    apiKey: formString(formData, 'apiKey'),
    webhookSecret: formString(formData, 'webhookSecret'),
    environment: formString(formData, 'environment') || 'SANDBOX',
    displayName: formString(formData, 'displayName') || null,
  };
  const repo = getCommerceRepository();
  const result = await connectPaymentOS(repo, { tenantId, raw, actorId: session.user.id });
  if (result.outcome === 'error') {
    redirect(toQuery('/app/settings/payments', { error: result.code, message: result.message.slice(0, 160) }));
  }
  revalidatePath('/app/settings/payments');
  redirect('/app/settings/payments?success=connected');
}

export async function verifyConnectionAction() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  const repo = getCommerceRepository();
  const result = await verifyConnection(repo, { tenantId: session.tenant.id });
  const success = result.status === 'CONNECTED';
  revalidatePath('/app/settings/payments');
  redirect(
    toQuery('/app/settings/payments', {
      success: success ? 'connection-verified' : undefined,
      error: success ? undefined : (result.code ?? 'connection-verification-failed'),
      message: success ? undefined : result.message.slice(0, 160),
    }),
  );
}

export async function rotateCredentialsAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  const tenantId = session.tenant.id;
  const raw = {
    providerTenantId: formString(formData, 'providerTenantId'),
    apiKey: formString(formData, 'apiKey'),
    webhookSecret: formString(formData, 'webhookSecret'),
    environment: formString(formData, 'environment') || 'SANDBOX',
    displayName: null,
  };
  const repo = getCommerceRepository();
  const result = await rotateConnectionCredentials(repo, { tenantId, raw, actorId: session.user.id });
  if (result.outcome === 'error') {
    redirect(toQuery('/app/settings/payments', { error: result.code, message: result.message.slice(0, 160) }));
  }
  revalidatePath('/app/settings/payments');
  redirect(
    result.outcome === 'unchanged'
      ? toQuery('/app/settings/payments', { message: result.message })
      : '/app/settings/payments?success=credentials-rotated',
  );
}

export async function disconnectConnectionAction() {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  const repo = getCommerceRepository();
  await disconnectConnection(repo, { tenantId: session.tenant.id });
  revalidatePath('/app/settings/payments');
  redirect('/app/settings/payments?success=disconnected');
}
