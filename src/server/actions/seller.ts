'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireSession } from '@/server/auth/demo-session';
import { checkSellerRateLimit } from '@/server/auth/seller-limit';
import {
  SellerError,
  assertSellerOperationAllowed,
} from '@/server/commerce/seller';
import {
  issueSellerCredential,
  revokeSellerCredential,
  rotateSellerCredential,
  touchSellerCredentialUsed,
  verifySellerCredential,
} from '@/server/commerce/seller-store';
import { getQrWrapKey } from '@/server/crypto/qr-wrap';
import {
  createOrder,
  finalizeApprovedOrder,
  submitOrder,
  type CommerceStore,
} from '@/server/commerce/commerce-store';
import { CommerceError, type CartLineRequest } from '@/server/commerce/orders';
import { CartFormError, parseCartFormEntries } from '@/server/commerce/cart-form';
import { InventoryError } from '@/server/commerce/inventory';
import { SaleValidationError, parseKenyanPhoneInput } from '@/server/commerce/sale-validation';
import { normalizeIdempotencyKey, IdempotencyKeyError } from '@/server/commerce/idempotency';
import { readStore, updateStore } from '@/server/store';
import type { StoreState } from '@/server/store/types';

function formString(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function commerceStoreOf(store: StoreState): CommerceStore {
  return store as unknown as CommerceStore;
}

function sellerErrorCode(error: unknown): string {
  if (
    error instanceof SellerError ||
    error instanceof CommerceError ||
    error instanceof InventoryError ||
    error instanceof SaleValidationError ||
    error instanceof CartFormError
  ) {
    return error.code;
  }
  if (error instanceof IdempotencyKeyError) {
    return 'invalid-idempotency-key';
  }
  throw error;
}

// ── Admin credential management ──────────────────────────────────────────────

export async function issueSellerCredentialAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  const sellerId = formString(formData, 'sellerId');

  try {
    const result = await updateStore((store) => {
      const seller = store.users.find((item) => item.id === sellerId) ?? null;
      if (!seller || (session.user.role !== 'super_admin' && seller.tenantId !== session.tenant!.id)) {
        throw new SellerError('unknown-seller', 'Seller not found for this shop.');
      }
      return issueSellerCredential(commerceStoreOf(store) as unknown as Parameters<typeof issueSellerCredential>[0], {
        tenantId: seller.tenantId ?? session.tenant!.id,
        sellerId: seller.id,
        createdBy: session.user.id,
        // Sealed copy enables later reprints when QR_WRAP_KEY is configured.
      }, { wrapKey: getQrWrapKey() });
    });
    revalidatePath('/app/settings/staff');
    redirect(
      `/app/settings/staff?showSellerRef=${result.credential.publicReference}&showSellerBearer=${result.bearer}&success=seller-qr-issued`,
    );
  } catch (error) {
    redirect(`/app/settings/staff?error=${sellerErrorCode(error)}`);
  }
}

export async function rotateSellerCredentialAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  const sellerId = formString(formData, 'sellerId');

  try {
    const result = await updateStore((store) => {
      const seller = store.users.find((item) => item.id === sellerId) ?? null;
      if (!seller || (session.user.role !== 'super_admin' && seller.tenantId !== session.tenant!.id)) {
        throw new SellerError('unknown-seller', 'Seller not found for this shop.');
      }
      return rotateSellerCredential(commerceStoreOf(store) as unknown as Parameters<typeof rotateSellerCredential>[0], {
        tenantId: seller.tenantId ?? session.tenant!.id,
        sellerId: seller.id,
        createdBy: session.user.id,
      }, { wrapKey: getQrWrapKey() });
    });
    revalidatePath('/app/settings/staff');
    redirect(
      `/app/settings/staff?showSellerRef=${result.credential.publicReference}&showSellerBearer=${result.bearer}&success=seller-qr-rotated`,
    );
  } catch (error) {
    redirect(`/app/settings/staff?error=${sellerErrorCode(error)}`);
  }
}

export async function revokeSellerCredentialAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }
  const sellerId = formString(formData, 'sellerId');

  try {
    await updateStore((store) => {
      const seller = store.users.find((item) => item.id === sellerId) ?? null;
      if (!seller || (session.user.role !== 'super_admin' && seller.tenantId !== session.tenant!.id)) {
        throw new SellerError('unknown-seller', 'Seller not found for this shop.');
      }
      revokeSellerCredential(commerceStoreOf(store) as unknown as Parameters<typeof revokeSellerCredential>[0], {
        tenantId: seller.tenantId ?? session.tenant!.id,
        sellerId: seller.id,
      });
    });
    revalidatePath('/app/settings/staff');
    redirect('/app/settings/staff?success=seller-qr-revoked');
  } catch (error) {
    redirect(`/app/settings/staff?error=${sellerErrorCode(error)}`);
  }
}

// ── Public QR transaction (transaction-only context) ─────────────────────────

/** Parse the 4 no-JS cart rows via the shared normalizer (skips blank items). */
function parseQrCart(formData: FormData): CartLineRequest[] {
  return parseCartFormEntries(formData.entries());
}

export async function submitSellerQrOrderAction(formData: FormData) {
  const reference = formString(formData, 'reference');
  const bearer = formString(formData, 'bearer');

  if (!checkSellerRateLimit(reference || 'unknown')) {
    redirect(`/sell/${reference}?error=rate-limited`);
  }

  let key: string | null = null;
  let paymentMethod: 'CASH' | 'MPESA' = 'CASH';
  let customerPhone: string | null = null;
  try {
    assertSellerOperationAllowed('CREATE_ORDER');
    key = normalizeIdempotencyKey(formString(formData, 'idempotencyKey'));
    // Phase 3 payment boundary: Cash completes today; M-Pesa records a
    // validated phone intent and holds the order for Phase 4 (no STK call,
    // no success record, no stock movement until payment exists).
    paymentMethod = formString(formData, 'paymentMethod') === 'mpesa' ? 'MPESA' : 'CASH';
    const phoneRaw = formString(formData, 'customerPhone');
    if (paymentMethod === 'MPESA') {
      customerPhone = parseKenyanPhoneInput(phoneRaw || null, 'customerPhone');
    }
  } catch (error) {
    redirect(`/sell/${reference}?error=${sellerErrorCode(error)}`);
  }

  try {
    const result = await updateStore((store) => {
      const commerce = commerceStoreOf(store);
      // Seller identity comes ONLY from the verified credential — never the form.
      const context = verifySellerCredential(
        commerce as unknown as Parameters<typeof verifySellerCredential>[0],
        { tenantId: resolveQrTenant(store, reference), reference, bearer },
      );
      const tenant = store.tenants.find((item) => item.id === context.tenantId) ?? null;
      const policy = tenant?.orderReviewRequired ?? true;

      const customerId = formString(formData, 'customerId') || null;
      if (customerId) {
        const customer = store.customers.find((item) => item.id === customerId) ?? null;
        if (!customer || customer.tenantId !== context.tenantId) {
          throw new CommerceError('unknown-item', 'Customer not found for this shop.');
        }
      }

      const created = createOrder(commerce, {
        tenantId: context.tenantId,
        customerId,
        sellerId: context.sellerId,
        source: 'SELLER_QR',
        notes: formString(formData, 'notes') || null,
        lines: parseQrCart(formData),
        clientTotal: null,
        idempotencyKey: key,
        creatorRole: 'staff',
        creatorId: context.sellerId,
        orderReviewRequired: policy,
        sellerCredentialId: context.credentialId,
        paymentMethod,
        customerPhone,
      });

      if (created.duplicate) {
        return { orderId: created.order.id, finalizedSaleId: null as string | null, duplicate: true };
      }

      const submitted = submitOrder(commerce, {
        tenantId: context.tenantId,
        orderId: created.order.id,
        actorId: context.sellerId,
        actorRole: 'staff',
        orderReviewRequired: policy,
        forceReview: paymentMethod === 'MPESA',
      });

      let finalizedSaleId: string | null = null;
      if (submitted.route === 'AUTO_APPROVE') {
        const finalized = finalizeApprovedOrder(commerce, {
          tenantId: context.tenantId,
          orderId: created.order.id,
          actorId: context.sellerId,
        });
        finalizedSaleId = finalized.sale.id;
      }

      touchSellerCredentialUsed(
        commerce as unknown as Parameters<typeof touchSellerCredentialUsed>[0],
        { tenantId: context.tenantId, credentialId: context.credentialId },
      );

      return { orderId: created.order.id, finalizedSaleId, duplicate: false };
    });

    revalidatePath(`/sell/${reference}`);
    const receipt = result.finalizedSaleId
      ? `&saleId=${result.finalizedSaleId}`
      : '';
    redirect(
      `/sell/${reference}?k=${encodeURIComponent(bearer)}&orderId=${result.orderId}${receipt}&success=${result.duplicate ? 'order-duplicate' : 'order-created'}`,
    );
  } catch (error) {
    redirect(`/sell/${reference}?error=${sellerErrorCode(error)}`);
  }
}

/** Resolve the tenant owning a reference without verifying the bearer (for context setup). */
function resolveQrTenant(store: StoreState, reference: string): string {
  const row = (store.sellerCredentials ?? []).find((item) => item.publicReference === reference) ?? null;
  if (!row) {
    throw new SellerError('invalid-reference', 'This seller QR code is not recognized.');
  }
  return row.tenantId;
}

export async function getSellerQrContext(reference: string, bearer: string) {
  const store = await readStore();
  const tenantId = resolveQrTenant(store, reference);
  const context = verifySellerCredential(
    commerceStoreOf(store) as unknown as Parameters<typeof verifySellerCredential>[0],
    { tenantId, reference, bearer },
  );
  const tenant = store.tenants.find((item) => item.id === context.tenantId) ?? null;
  const seller = store.users.find((item) => item.id === context.sellerId) ?? null;
  return {
    tenantId: context.tenantId,
    tenantName: tenant?.name ?? null,
    currencyCode: tenant?.currencyCode ?? 'KES',
    sellerId: context.sellerId,
    sellerName: seller?.fullName ?? null,
    credentialId: context.credentialId,
  };
}
