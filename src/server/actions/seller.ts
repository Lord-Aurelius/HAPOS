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
} from '@/server/commerce/seller-store';
import { getQrWrapKey } from '@/server/crypto/qr-wrap';
import { CommerceError, type CartLineRequest } from '@/server/commerce/orders';
import { CartFormError, parseCartFormEntries } from '@/server/commerce/cart-form';
import { InventoryError } from '@/server/commerce/inventory';
import { SaleValidationError, parseKenyanPhoneInput } from '@/server/commerce/sale-validation';
import { normalizeIdempotencyKey, IdempotencyKeyError } from '@/server/commerce/idempotency';
import type { CommerceStore } from '@/server/commerce/commerce-store';
import { getCommerceRepository } from '@/server/commerce/repository-select';
import { getCallbackBaseUrl, getPaymentGateway, initiateMpesaPayment, recordCashPayment, retryMpesaPayment } from '@/server/payments/payment-service';
import { PaymentError } from '@/server/commerce/payments';
import { GatewayError } from '@/server/payments/gateway';
import { PaymentConnectionError } from '@/server/payments/connection';
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
    error instanceof CartFormError ||
    error instanceof PaymentError
  ) {
    return error.code;
  }
  if (error instanceof IdempotencyKeyError) {
    return 'invalid-idempotency-key';
  }
  if (error instanceof GatewayError) {
    return error.code;
  }
  if (error instanceof PaymentConnectionError) {
    // Rendered through the same friendly-message map as gateway errors.
    return error.code;
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
    const repo = getCommerceRepository();
    // Seller identity comes ONLY from the verified credential — never the form.
    const tenantId = await repo.resolveSellerCredentialTenant(reference);
    if (!tenantId) {
      throw new SellerError('invalid-reference', 'This seller QR code is not recognized.');
    }
    const context = await repo.verifySellerCredential(tenantId, reference, bearer);
    const policy = await repo.getTenantPolicy(tenantId);

    const customerId = null;

    const created = await repo.createOrder({
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
      orderReviewRequired: policy.orderReviewRequired,
      sellerCredentialId: context.credentialId,
      paymentMethod,
      customerPhone,
    });

    if (created.duplicate) {
      revalidatePath(`/sell/${reference}`);
      redirect(
        `/sell/${reference}?k=${encodeURIComponent(bearer)}&orderId=${created.order.id}&success=order-duplicate`,
      );
    }

    const submitted = await repo.submitOrder({
      tenantId: context.tenantId,
      orderId: created.order.id,
      actorId: context.sellerId,
      actorRole: 'staff',
      orderReviewRequired: policy.orderReviewRequired,
      forceReview: paymentMethod === 'MPESA',
    });

    let finalizedSaleId: string | null = null;
    if (submitted.route === 'AUTO_APPROVE') {
      // Cash only reaches here (M-Pesa is always force-held for payment).
      const finalized = await repo.finalizeApprovedOrder({
        tenantId: context.tenantId,
        orderId: created.order.id,
        actorId: context.sellerId,
      });
      finalizedSaleId = finalized.sale.id;
      await recordCashPayment(repo, {
        tenantId: context.tenantId,
        orderId: created.order.id,
        saleId: finalized.sale.id,
        amount: finalized.sale.total,
        currencyCode: finalized.sale.currencyCode,
        actorId: context.sellerId,
      });
    } else if (paymentMethod === 'MPESA') {
      // Collect payment intent now; provider confirmation finalizes later.
      // No DB transaction is held across the gateway call.
      await initiateMpesaPayment(repo, getPaymentGateway(), {
        tenantId: context.tenantId,
        orderId: created.order.id,
        actorId: context.sellerId,
        customerPhone,
        idempotencyKey: key ? `${key}-mpesa` : null,
        callbackBaseUrl: getCallbackBaseUrl(),
      });
    }

    await repo.touchSellerCredentialUsed(context.tenantId, context.credentialId);

    revalidatePath(`/sell/${reference}`);
    const receipt = finalizedSaleId ? `&saleId=${finalizedSaleId}` : '';
    redirect(
      `/sell/${reference}?k=${encodeURIComponent(bearer)}&orderId=${created.order.id}${receipt}&success=order-created`,
    );
  } catch (error) {
    redirect(`/sell/${reference}?error=${sellerErrorCode(error)}`);
  }
}

/**
 * Retry M-Pesa on the seller's own held order (new attempt, same order —
 * never a duplicate sale). Credential context only; no login required.
 */
export async function retrySellerQrPaymentAction(formData: FormData) {
  const reference = formString(formData, 'reference');
  const bearer = formString(formData, 'bearer');
  const orderId = formString(formData, 'orderId');

  if (!checkSellerRateLimit(reference || 'unknown')) {
    redirect(`/sell/${reference}?error=rate-limited`);
  }

  try {
    const repo = getCommerceRepository();
    const tenantId = await repo.resolveSellerCredentialTenant(reference);
    if (!tenantId) {
      throw new SellerError('invalid-reference', 'This seller QR code is not recognized.');
    }
    const context = await repo.verifySellerCredential(tenantId, reference, bearer);
    const order = await repo.getOrderView(tenantId, orderId);
    if (!order || order.sellerId !== context.sellerId) {
      throw new SellerError('invalid-reference', 'That order does not belong to this seller QR.');
    }
    await retryMpesaPayment(repo, getPaymentGateway(), {
      tenantId,
      orderId,
      actorId: context.sellerId,
      callbackBaseUrl: getCallbackBaseUrl(),
    });
    await repo.touchSellerCredentialUsed(tenantId, context.credentialId);
    revalidatePath(`/sell/${reference}`);
    redirect(
      `/sell/${reference}?k=${encodeURIComponent(bearer)}&orderId=${orderId}&success=payment-requested`,
    );
  } catch (error) {
    redirect(`/sell/${reference}?error=${sellerErrorCode(error)}`);
  }
}

export async function getSellerQrContext(reference: string, bearer: string) {
  const repo = getCommerceRepository();
  const tenantId = await repo.resolveSellerCredentialTenant(reference);
  if (!tenantId) {
    throw new SellerError('invalid-reference', 'This seller QR code is not recognized.');
  }
  const context = await repo.verifySellerCredential(tenantId, reference, bearer);
  const policy = await repo.getTenantPolicy(tenantId);
  return {
    tenantId: context.tenantId,
    tenantName: policy.name,
    currencyCode: policy.currencyCode,
    sellerId: context.sellerId,
    sellerName: context.sellerName ?? null,
    credentialId: context.credentialId,
  };
}
