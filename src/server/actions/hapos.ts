'use server';

import { randomUUID } from 'node:crypto';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { parseDateTimeInputValue } from '@/lib/date-time';
import { isPlatinumPlan, normalizePlanCode } from '@/lib/plans';
import { storeImageAsset } from '@/server/assets';
import { getAccessState } from '@/server/auth/access';
import { signInCustomerSession, signOutCustomerSession } from '@/server/auth/customer-session';
import { requireSession, signInSession, signOutSession } from '@/server/auth/demo-session';
import { buildLoginRateLimitKey, getLoginRateLimiter } from '@/server/auth/rate-limit';
import {
  SaleValidationError,
  parseExpenseDateInput,
  parseMoneyInput,
  parseOptionalMoneyInput,
  parseProductQuantityInput,
  requireDisplayName,
  resolveProductUsage,
} from '@/server/commerce/sale-validation';
import {
  IdempotencyKeyError,
  findExistingSaleRecord,
  normalizeIdempotencyKey,
} from '@/server/commerce/idempotency';
import {
  assertSkuUnique,
  validateProductInput,
  validateServiceInput,
} from '@/server/commerce/catalog';
import {
  amendEngineSaleForCorrection,
  approveOrder,
  createOrder,
  finalizeApprovedOrder,
  submitOrder,
  voidSale,
} from '@/server/commerce/commerce-store';
import {
  adjustProductStock,
  ensureCatalogProjection,
  postOpeningBalance,
  replaceServiceBom,
} from '@/server/commerce/inventory-store';
import { InventoryError } from '@/server/commerce/inventory';
import { CommerceError } from '@/server/commerce/orders';
import { assertValidEmployeeNumber, normalizeEmployeeNumber } from '@/server/commerce/attendance';
import { calculateCommission } from '@/server/services/app-data';
import { dispatchSmsLogs } from '@/server/services/sms';
import { recordAiEvent } from '@/server/aegis/events';
import { voidServiceRecord } from '@/server/store/service-records';
import { authenticateCustomer, authenticateUser, readStore, updateStore } from '@/server/store';
import type { CommerceStore } from '@/server/commerce/commerce-store';
import type { StoreState } from '@/server/store/types';

function storeAsCommerceStore(store: StoreState): CommerceStore {
  // Structural projection cast: StoreState carries every commerce collection.
  return store as unknown as CommerceStore;
}

function formString(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

function formNumber(formData: FormData, key: string) {
  const raw = formString(formData, key);
  return raw ? Number(raw) : 0;
}

function formNullableString(formData: FormData, key: string) {
  const value = formString(formData, key);
  return value || null;
}

function formCheckbox(formData: FormData, key: string) {
  const value = formData.get(key);
  return value === 'on' || value === 'true';
}

function normalizePhoneInput(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('+')) {
    return `+${trimmed.slice(1).replace(/\D/g, '')}`;
  }

  return trimmed.replace(/\D/g, '');
}

function normalizePhoneLookup(value: string) {
  return value.replace(/\D/g, '');
}

function parseFeatureLines(formData: FormData, key: string) {
  return String(formData.get(key) ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function resolveSubscriptionPackage(
  store: StoreState,
  formData: FormData,
  fallbackCode = 'basic',
) {
  const requestedPackageId = formString(formData, 'packageId');
  const requestedPlanCode = normalizePlanCode(formString(formData, 'planCode') || fallbackCode);

  return (
    (requestedPackageId
      ? store.subscriptionPackages.find((item) => item.id === requestedPackageId)
      : null) ??
    store.subscriptionPackages.find((item) => item.code === requestedPlanCode) ??
    store.subscriptionPackages.find((item) => item.code === fallbackCode) ??
    store.subscriptionPackages[0] ??
    null
  );
}

function normalizeBillingPeriod(value: string) {
  if (value === 'quarterly' || value === 'annual' || value === 'custom') {
    return value;
  }

  return 'monthly';
}

function normalizeLoyaltyRewardType(value: string) {
  return value === 'subsidized_service' ? 'subsidized_service' : 'free_service';
}

const MAX_UPLOADED_IMAGE_BYTES = 1_500_000;

async function storeUploadedImage(file: File | null, assetPrefix: string) {
  if (!file || file.size === 0) {
    return null;
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Uploads must be image files.');
  }

  if (file.size > MAX_UPLOADED_IMAGE_BYTES) {
    throw new Error('Uploads must stay under 1.5 MB.');
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  return storeImageAsset({
    bytes,
    mimeType: file.type || 'image/png',
    assetPrefix,
  });
}

async function storeTenantLogo(file: File | null, tenantId: string) {
  return storeUploadedImage(file, `tenant-${tenantId}`);
}

async function storeServiceImage(file: File | null, serviceId: string) {
  return storeUploadedImage(file, `service-${serviceId}`);
}

async function storeMarketplaceImage(file: File | null, adId: string) {
  return storeUploadedImage(file, `advert-${adId}`);
}

function formDateTimeString(formData: FormData, key: string) {
  const value = formString(formData, key);
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function formDateTimeStringForTimeZone(formData: FormData, key: string, timeZone: string) {
  const value = formString(formData, key);
  if (!value) {
    return null;
  }

  return parseDateTimeInputValue(value, timeZone);
}

function touchShopPaths() {
  revalidatePath('/app/dashboard');
  revalidatePath('/app/service-entry');
  revalidatePath('/app/sales');
  revalidatePath('/app/customers');
  revalidatePath('/app/services');
  revalidatePath('/app/marketplace');
  revalidatePath('/app/products');
  revalidatePath('/app/expenses');
  revalidatePath('/app/commissions');
  revalidatePath('/app/reports/monthly');
  revalidatePath('/app/history');
  revalidatePath('/app/settings/staff');
  revalidatePath('/app/settings/loyalty');
  revalidatePath('/customer/dashboard');
  revalidatePath('/customer/services');
  revalidatePath('/customer/marketplace');
  revalidatePath('/blocked');
}

function upsertTenantCustomer(store: StoreState, input: { tenantId: string; customerName: string; customerPhone: string }) {
  const now = new Date().toISOString();
  const normalizedPhone = normalizePhoneInput(input.customerPhone);
  const phoneLookup = normalizePhoneLookup(normalizedPhone);
  let customer = store.customers.find(
    (item) =>
      item.tenantId === input.tenantId &&
      normalizePhoneLookup(item.phoneE164 || item.phone) === phoneLookup,
  );

  if (!customer) {
    customer = {
      id: randomUUID(),
      tenantId: input.tenantId,
      name: input.customerName,
      phone: normalizedPhone,
      phoneE164: normalizedPhone,
      marketingOptIn: true,
      createdAt: now,
      updatedAt: now,
    };
    store.customers.push(customer);
  } else {
    customer.name = input.customerName || customer.name;
    customer.phone = normalizedPhone || customer.phone;
    customer.phoneE164 = normalizedPhone || customer.phoneE164;
    customer.archivedAt = null;
    customer.updatedAt = now;
  }

  return customer;
}

function buildProductUsages(store: StoreState, tenantId: string, productId: string, productQuantity: number) {
  // Unknown products throw SaleValidationError('unknown-product') instead of
  // silently resolving to []. Empty productId / zero quantity stays [] so the
  // service-entry default (qty=1, no product) remains a no-op.
  return resolveProductUsage(store.products, tenantId, productId || null, productQuantity);
}

function ensurePlatinumTenant(store: StoreState, tenantId: string) {
  const subscription = store.subscriptions.find((item) => item.tenantId === tenantId);
  const subscriptionPackage = subscription
    ? store.subscriptionPackages.find((item) => item.id === subscription.packageId || item.code === subscription.planCode) ?? null
    : null;

  return Boolean(subscriptionPackage?.includesMarketplace) || isPlatinumPlan(subscription?.planCode);
}

export async function loginAction(formData: FormData) {
  const businessSlug = formString(formData, 'businessSlug');
  const username = formString(formData, 'username');
  const password = formString(formData, 'password');

  // Phase 0.9: same per-shop+username throttle as the API login route.
  if (businessSlug && username) {
    const decision = getLoginRateLimiter().attempt(buildLoginRateLimitKey(businessSlug, username));
    if (!decision.allowed) {
      redirect('/login?error=rate-limited');
    }
  }

  const auth = await authenticateUser({ businessSlug, username, password });
  if (!auth) {
    redirect('/login?error=invalid');
  }

  await signInSession({
    userId: auth.user.id,
    tenantId: auth.tenant?.id ?? null,
    role: auth.user.role,
  });

  if (auth.user.role !== 'super_admin') {
    const accessState = getAccessState({
      tenantStatus: auth.tenant?.status,
      suspensionReason: auth.tenant?.suspensionReason,
      subscriptionStatus: auth.subscription?.status,
      endsAt: auth.subscription?.endsAt,
      graceEndsAt: auth.subscription?.graceEndsAt,
    });

    if (accessState.blocked) {
      // Phase 0.9: do not leave a usable session behind for blocked tenants.
      await signOutSession();
      redirect(`/blocked?reason=${accessState.reason}`);
    }
  }

  getLoginRateLimiter().reset(buildLoginRateLimitKey(businessSlug, username));
  redirect(auth.user.role === 'super_admin' ? '/super/tenants' : '/app/dashboard');
}

export async function logoutAction() {
  await signOutSession();
  redirect('/login');
}

export async function customerLoginAction(formData: FormData) {
  const businessSlug = formString(formData, 'businessSlug');
  const phone = formString(formData, 'phone');

  const auth = await authenticateCustomer({ businessSlug, phone });
  if (!auth) {
    redirect('/customer/login?error=invalid');
  }

  const accessState = getAccessState({
    tenantStatus: auth.tenant.status,
    suspensionReason: auth.tenant.suspensionReason,
    subscriptionStatus: auth.subscription?.status,
    endsAt: auth.subscription?.endsAt,
    graceEndsAt: auth.subscription?.graceEndsAt,
  });

  if (accessState.blocked) {
    redirect('/customer/login?error=blocked');
  }

  await signInCustomerSession({
    customerId: auth.customer.id,
    tenantId: auth.tenant.id,
  });

  redirect('/customer/dashboard');
}

export async function customerLogoutAction() {
  await signOutCustomerSession();
  redirect('/customer/login');
}

export async function submitCustomerOrderAction(formData: FormData) {
  const businessSlug = formString(formData, 'businessSlug');
  const customerName = formString(formData, 'customerName');
  const customerPhone = normalizePhoneInput(formString(formData, 'customerPhone'));
  const serviceId = formString(formData, 'serviceId');
  const requestedStaffId = formString(formData, 'requestedStaffId');
  const notes = formString(formData, 'notes');

  if (!businessSlug || !customerName || !customerPhone || !serviceId) {
    redirect(`/book/${businessSlug || 'shop'}?error=missing-fields`);
  }

  const result = await updateStore((store) => {
    const tenant = store.tenants.find((item) => item.slug.toLowerCase() === businessSlug.toLowerCase()) ?? null;
    if (!tenant) {
      return { status: 'tenant-not-found' as const };
    }

    const subscription = store.subscriptions.find((item) => item.tenantId === tenant.id) ?? null;
    const accessState = getAccessState({
      tenantStatus: tenant.status,
      suspensionReason: tenant.suspensionReason,
      subscriptionStatus: subscription?.status,
      endsAt: subscription?.endsAt,
      graceEndsAt: subscription?.graceEndsAt,
    });

    if (accessState.blocked) {
      return { status: 'blocked' as const, slug: tenant.slug, reason: accessState.reason };
    }

    const service = store.services.find(
      (item) => item.tenantId === tenant.id && item.id === serviceId && item.isActive,
    );
    if (!service) {
      return { status: 'service-not-found' as const, slug: tenant.slug };
    }

    const staff = requestedStaffId
      ? store.users.find(
          (item) =>
            item.tenantId === tenant.id &&
            item.id === requestedStaffId &&
            item.isActive &&
            (item.role === 'staff' || item.role === 'shop_admin'),
        ) ?? null
      : null;

    if (requestedStaffId && !staff) {
      return { status: 'staff-not-found' as const, slug: tenant.slug };
    }

    const customer = upsertTenantCustomer(store, {
      tenantId: tenant.id,
      customerName,
      customerPhone,
    });

    const now = new Date().toISOString();
    store.customerOrders.unshift({
      id: randomUUID(),
      tenantId: tenant.id,
      customerId: customer.id,
      serviceId: service.id,
      serviceName: service.name,
      quotedPrice: service.price,
      requestedStaffId: staff?.id ?? null,
      requestedName: customer.name,
      requestedPhone: customer.phoneE164 || customer.phone,
      notes: notes || undefined,
      status: 'pending',
      requestedAt: now,
      statusUpdatedAt: null,
      approvedAt: null,
      approvedBy: null,
      approvedRecordId: null,
      createdAt: now,
    });

    return {
      status: 'queued' as const,
      slug: tenant.slug,
      phone: customer.phoneE164 || customer.phone,
    };
  });

  if (result.status === 'tenant-not-found') {
    redirect('/login');
  }

  if (result.status === 'blocked') {
    redirect(`/book/${result.slug}?error=blocked`);
  }

  if (result.status === 'service-not-found') {
    redirect(`/book/${result.slug}?error=service-not-found`);
  }

  if (result.status === 'staff-not-found') {
    redirect(`/book/${result.slug}?error=staff-not-found`);
  }

  touchShopPaths();
  revalidatePath(`/book/${result.slug}`);
  redirect(`/book/${result.slug}?success=queued&phone=${encodeURIComponent(result.phone)}`);
}

export async function updateCustomerOrderStatusAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }

  const orderId = formString(formData, 'orderId');
  const nextStatus = formString(formData, 'nextStatus');
  const redirectTo = formString(formData, 'redirectTo') || '/app/service-entry?success=request-updated';

  if (nextStatus !== 'acknowledged' && nextStatus !== 'cancelled' && nextStatus !== 'pending') {
    redirect(redirectTo.replace('success=request-updated', 'error=request-invalid'));
  }

  await updateStore((store) => {
    const order = store.customerOrders.find((item) => item.id === orderId);
    if (!order) {
      return;
    }

    if (order.tenantId !== session.tenant!.id) {
      throw new Error('Cannot update customer orders outside your tenant.');
    }

    order.status = nextStatus;
    order.statusUpdatedAt = new Date().toISOString();
  });

  touchShopPaths();
  revalidatePath(`/book/${session.tenant.slug}`);
  redirect(redirectTo);
}

export async function approveCustomerOrderToSalesAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }

  const tenantTimeZone = formString(formData, 'tenantTimeZone') || session.tenant.timezone || 'UTC';
  const orderId = formString(formData, 'orderId');
  const staffId = formString(formData, 'staffId');
  const performedAtRaw = formString(formData, 'performedAt');
  const performedAt = formDateTimeStringForTimeZone(formData, 'performedAt', tenantTimeZone);
  const description = formString(formData, 'description');

  if (performedAtRaw && !performedAt) {
    redirect('/app/sales?error=approval-invalid-date');
  }

  const result = await updateStore((store) => {
    const order = store.customerOrders.find((item) => item.id === orderId);
    if (!order || order.tenantId !== session.tenant!.id) {
      return { status: 'missing' as const };
    }

    if (order.status === 'approved' && order.approvedRecordId) {
      return { status: 'already-approved' as const, recordId: order.approvedRecordId };
    }

    if (order.status === 'cancelled') {
      return { status: 'cancelled' as const };
    }

    const staff = store.users.find(
      (item) =>
        item.tenantId === session.tenant!.id &&
        item.id === staffId &&
        item.isActive &&
        (item.role === 'staff' || item.role === 'shop_admin'),
    );
    if (!staff) {
      return { status: 'staff-not-found' as const };
    }

    const service = store.services.find(
      (item) => item.tenantId === session.tenant!.id && item.id === order.serviceId && item.isActive,
    );
    if (!service) {
      return { status: 'service-not-found' as const };
    }

    const customer = store.customers.find((item) => item.tenantId === session.tenant!.id && item.id === order.customerId);
    if (!customer) {
      return { status: 'customer-not-found' as const };
    }

    const price = order.quotedPrice > 0 ? order.quotedPrice : service.price;
    const commission = calculateCommission({
      service: { commissionType: service.commissionType, commissionValue: service.commissionValue },
      staff: { commissionType: staff.commissionType, commissionValue: staff.commissionValue },
      price,
    });

    const now = new Date().toISOString();
    const recordId = randomUUID();

    // Phase 2: the booking becomes a canonical commerce order (source
    // CUSTOMER_BOOKING) and the admin approval finalizes its sale with atomic
    // BOM consumption — same mutator as the legacy co-write below. A stale
    // quote that differs from catalog is an explicit, reasoned override.
    let commerceSaleId: string | null = null;
    try {
      const tenant = store.tenants.find((item) => item.id === session.tenant!.id) ?? null;
      const created = createOrder(storeAsCommerceStore(store), {
        tenantId: session.tenant!.id,
        customerId: customer.id,
        sellerId: staff.id,
        source: 'CUSTOMER_BOOKING',
        notes: description || order.notes || null,
        lines: [
          {
            kind: 'service',
            refId: service.id,
            quantity: 1,
            actualUnitPrice: price,
            overrideReason: price !== service.price ? 'Booking quoted price' : null,
          },
        ],
        idempotencyKey: `booking-${order.id}`,
        creatorRole: session.user.role,
        creatorId: session.user.id,
        orderReviewRequired: tenant?.orderReviewRequired ?? true,
      });
      if (!created.duplicate) {
        submitOrder(storeAsCommerceStore(store), {
          tenantId: session.tenant!.id,
          orderId: created.order.id,
          actorId: session.user.id,
          actorRole: session.user.role,
          orderReviewRequired: tenant?.orderReviewRequired ?? true,
        });
      }
      const approved = approveOrder(storeAsCommerceStore(store), {
        tenantId: session.tenant!.id,
        orderId: created.order.id,
        actorId: session.user.id,
        actorRole: session.user.role,
      });
      commerceSaleId = approved.sale.id;
    } catch (error) {
      if (error instanceof CommerceError || error instanceof InventoryError) {
        return { status: 'commerce-failed' as const, code: error.code };
      }
      throw error;
    }

    store.serviceRecords.push({
      id: recordId,
      tenantId: session.tenant!.id,
      customerId: customer.id,
      staffId: staff.id,
      serviceId: service.id,
      serviceName: service.name,
      isCustomService: false,
      price,
      description: description || order.notes,
      commissionType: commission.commissionType,
      commissionValue: commission.commissionValue,
      commissionAmount: commission.commissionAmount,
      productUsages: [],
      performedAt: performedAt ?? now,
      recordedBy: session.user.id,
      correctedAt: null,
      correctedBy: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      // Approval is already exactly-once via the order's approvedRecordId
      // link; no client key participates here.
      idempotencyKey: null,
      commerceSaleId,
      createdAt: now,
    });

    order.serviceName = service.name;
    order.quotedPrice = price;
    order.requestedStaffId = staff.id;
    order.status = 'approved';
    order.statusUpdatedAt = now;
    order.approvedAt = now;
    order.approvedBy = session.user.id;
    order.approvedRecordId = recordId;

    return { status: 'approved' as const, recordId };
  });

  if (result.status === 'already-approved') {
    touchShopPaths();
    redirect(`/app/sales?recordId=${result.recordId}&success=request-approved`);
  }

  if (result.status === 'missing' || result.status === 'cancelled' || result.status === 'customer-not-found') {
    redirect('/app/sales?error=approval-missing');
  }

  if (result.status === 'staff-not-found') {
    redirect('/app/sales?error=approval-staff');
  }

  if (result.status === 'commerce-failed') {
    redirect(`/app/sales?error=${result.code}`);
  }

  if (result.status === 'service-not-found') {
    redirect('/app/sales?error=approval-service');
  }

  touchShopPaths();
  revalidatePath(`/book/${session.tenant.slug}`);
  redirect(`/app/sales?recordId=${result.recordId}&success=request-approved`);
}

export async function recordServiceAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }

  const tenantTimeZone = formString(formData, 'tenantTimeZone') || session.tenant.timezone || 'UTC';
  const customerName = formString(formData, 'customerName');
  const customerPhone = normalizePhoneInput(formString(formData, 'customerPhone'));
  const serviceMode = formString(formData, 'serviceMode');
  const selectedServiceId = formString(formData, 'serviceId');
  const customServiceName = formString(formData, 'customServiceName');
  const customPriceRaw = formString(formData, 'customPrice');
  const staffId = session.user.role === 'staff' ? session.user.id : formString(formData, 'staffId');
  const description = formString(formData, 'description');
  const productId = formString(formData, 'productId');
  const productQuantityRaw = formString(formData, 'productQuantity');
  const performedAtRaw = formString(formData, 'performedAt');
  const performedAt = formDateTimeStringForTimeZone(formData, 'performedAt', tenantTimeZone);

  if (!customerName || !customerPhone) {
    redirect('/app/service-entry?error=customer-required');
  }

  if (performedAtRaw && !performedAt) {
    redirect('/app/service-entry?error=invalid-date');
  }

  let requestedIdempotencyKey: string | null = null;
  try {
    requestedIdempotencyKey = normalizeIdempotencyKey(formString(formData, 'idempotencyKey'));
  } catch (error) {
    if (error instanceof IdempotencyKeyError) {
      redirect('/app/service-entry?error=invalid-idempotency-key');
    }
    throw error;
  }

  let customPrice = 0;
  let productQuantity = 0;
  try {
    customPrice = customPriceRaw ? parseMoneyInput(customPriceRaw, 'customPrice') : 0;
    productQuantity = parseProductQuantityInput(productQuantityRaw);
  } catch (error) {
    if (error instanceof SaleValidationError) {
      redirect(`/app/service-entry?error=${error.code}`);
    }
    throw error;
  }

  if (serviceMode === 'custom' && (!customServiceName || customPrice <= 0)) {
    redirect('/app/service-entry?error=custom-service');
  }

  const result = await updateStore((store) => {
    const tenantId = session.tenant!.id;

    // Phase 0.4: exactly-once claim runs INSIDE the atomic mutator, before any
    // customer upsert or SMS enqueue, so retries never duplicate side effects.
    const duplicate = findExistingSaleRecord(store.serviceRecords, tenantId, requestedIdempotencyKey);
    if (duplicate) {
      return { ok: true as const, smsIds: [] as string[], duplicate: true as const };
    }

    const tenantUsers = store.users.filter((user) => user.tenantId === tenantId);
    const tenantServices = store.services.filter((service) => service.tenantId === tenantId);
    const customer = upsertTenantCustomer(store, {
      tenantId,
      customerName,
      customerPhone,
    });

    const staff = tenantUsers.find((user) => user.id === staffId);
    if (!staff) {
      return { ok: false as const, error: 'staff-not-found' as const };
    }

    const service =
      serviceMode === 'price-list'
        ? tenantServices.find((item) => item.id === selectedServiceId) ?? null
        : null;
    if (serviceMode === 'price-list' && !service) {
      return { ok: false as const, error: 'service-not-found' as const };
    }

    const price = service ? service.price : customPrice;
    const serviceName = service ? service.name : customServiceName;

    const commission = calculateCommission({
      service: service ? { commissionType: service.commissionType, commissionValue: service.commissionValue } : null,
      staff: { commissionType: staff.commissionType, commissionValue: staff.commissionValue },
      price,
    });

    let usages: { productId: string; quantity: number; unitCost: number }[];
    try {
      usages = buildProductUsages(store, tenantId, productId, productQuantity);
    } catch (error) {
      if (error instanceof SaleValidationError) {
        return { ok: false as const, error: error.code as 'unknown-product' | 'invalid-quantity' };
      }
      throw error;
    }
    const now = new Date().toISOString();

    // Phase 2: price-list sales go through the canonical commerce engine
    // (order → auto-submit → finalized sale with atomic BOM consumption) and
    // the legacy row below is a compatibility co-write in the SAME mutator.
    // Custom off-menu sales have no catalog reference and stay legacy-only.
    // Product usage lines remain legacy cost-tracking (never retail SALE
    // movements) so uncounted stock can never block a salon sale.
    let commerceSaleId: string | null = null;
    if (service) {
      try {
        const tenant = store.tenants.find((item) => item.id === tenantId) ?? null;
        const created = createOrder(storeAsCommerceStore(store), {
          tenantId,
          customerId: customer.id,
          sellerId: staff.id,
          source: session.user.role === 'staff' ? 'STAFF' : 'ADMIN',
          notes: description || null,
          lines: [{ kind: 'service', refId: service.id, quantity: 1 }],
          idempotencyKey: requestedIdempotencyKey,
          creatorRole: session.user.role,
          creatorId: session.user.id,
          orderReviewRequired: tenant?.orderReviewRequired ?? true,
        });
        if (!created.duplicate) {
          const submitted = submitOrder(storeAsCommerceStore(store), {
            tenantId,
            orderId: created.order.id,
            actorId: session.user.id,
            actorRole: session.user.role,
            orderReviewRequired: tenant?.orderReviewRequired ?? true,
          });
          if (submitted.route === 'AUTO_APPROVE') {
            const finalized = finalizeApprovedOrder(storeAsCommerceStore(store), {
              tenantId,
              orderId: created.order.id,
              actorId: session.user.id,
            });
            commerceSaleId = finalized.sale.id;
          }
        } else {
          const linked = store.sales.find(
            (sale) => sale.orderId === created.order.id && sale.tenantId === tenantId,
          ) ?? null;
          commerceSaleId = linked?.id ?? null;
        }
      } catch (error) {
        if (error instanceof CommerceError || error instanceof InventoryError) {
          return { ok: false as const, error: error.code };
        }
        throw error;
      }
    }
    store.serviceRecords.push({
      id: randomUUID(),
      tenantId,
      customerId: customer.id,
      staffId: staff.id,
      serviceId: service?.id ?? null,
      serviceName,
      isCustomService: !service,
      price,
      description,
      commissionType: commission.commissionType,
      commissionValue: commission.commissionValue,
      commissionAmount: commission.commissionAmount,
      productUsages: usages,
      performedAt: performedAt ?? now,
      recordedBy: session.user.id,
      correctedAt: null,
      correctedBy: null,
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      // Keyless writes (legacy clients) mint a fresh key so every post-Phase-0
      // record carries one; future QR/PaymentOS retries reuse the client key.
      idempotencyKey: requestedIdempotencyKey ?? randomUUID(),
      commerceSaleId,
      createdAt: now,
    });

    const smsId = randomUUID();
    store.smsLogs.push({
      id: smsId,
      tenantId,
      customerId: customer.id,
      smsType: 'thank_you',
      recipientPhone: customer.phoneE164,
      message: `Thank you for visiting ${session.tenant!.name}, ${customer.name}.`,
      status: 'queued',
      createdAt: new Date().toISOString(),
    });

    return { ok: true as const, smsIds: [smsId], duplicate: false as const };
  });

  if (!result.ok) {
    redirect(`/app/service-entry?error=${result.error}`);
  }

  await dispatchSmsLogs(result.smsIds);
  touchShopPaths();
  redirect('/app/service-entry?success=recorded');
}

export async function updateServiceRecordAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  const recordId = formString(formData, 'recordId');
  const tenantId = formString(formData, 'tenantId') || session.tenant?.id;
  const redirectTo = formString(formData, 'redirectTo') || `/app/sales?recordId=${recordId}&success=record-updated`;
  const tenantTimeZone = formString(formData, 'tenantTimeZone') || session.tenant?.timezone || 'UTC';
  const customerName = formString(formData, 'customerName');
  const customerPhone = formString(formData, 'customerPhone');
  const serviceMode = formString(formData, 'serviceMode');
  const selectedServiceId = formString(formData, 'serviceId');
  const customServiceName = formString(formData, 'customServiceName');
  const customPriceRaw = formString(formData, 'customPrice');
  const staffId = formString(formData, 'staffId');
  const description = formString(formData, 'description');
  const productId = formString(formData, 'productId');
  const productQuantityRaw = formString(formData, 'productQuantity');
  const performedAtRaw = formString(formData, 'performedAt');
  const performedAt = formDateTimeStringForTimeZone(formData, 'performedAt', tenantTimeZone);

  if (!tenantId) {
    redirect('/super/tenants');
  }

  if (performedAtRaw && !performedAt) {
    redirect(`/app/sales?recordId=${recordId}&error=invalid-date`);
  }

  let customPrice = 0;
  let productQuantity = 0;
  try {
    customPrice = customPriceRaw ? parseMoneyInput(customPriceRaw, 'customPrice') : 0;
    productQuantity = parseProductQuantityInput(productQuantityRaw);
  } catch (error) {
    if (error instanceof SaleValidationError) {
      redirect(`/app/sales?recordId=${recordId}&error=${error.code}`);
    }
    throw error;
  }

  if (serviceMode === 'custom' && (!customServiceName || customPrice <= 0)) {
    redirect(`/app/sales?recordId=${recordId}&error=custom-service`);
  }

  // Validation failures inside the mutator are collected into `updateError`
  // and redirected (explicit UX) instead of throwing raw 500s. Engine
  // amendment failures throw instead: they must roll back the legacy edit in
  // the same mutator, and the outer catch below turns them into redirects.
  let updateError: string | null = null;
  const correctionReason = formString(formData, 'correctionReason');
  try {
  await updateStore((store) => {
    const record = store.serviceRecords.find((item) => item.id === recordId && item.tenantId === tenantId);
    if (!record) {
      updateError = 'record-missing';
      return;
    }
    if (record.voidedAt) {
      updateError = 'record-voided';
      return;
    }

    const tenantUsers = store.users.filter((user) => user.tenantId === tenantId);
    const tenantServices = store.services.filter((service) => service.tenantId === tenantId);
    const staff = tenantUsers.find((user) => user.id === staffId);
    if (!staff) {
      updateError = 'record-staff';
      return;
    }

    const customer = upsertTenantCustomer(store, {
      tenantId,
      customerName,
      customerPhone,
    });

    const service =
      serviceMode === 'price-list'
        ? tenantServices.find((item) => item.id === selectedServiceId) ?? null
        : null;

    if (serviceMode === 'price-list' && !service) {
      updateError = 'record-service';
      return;
    }

    let usages: { productId: string; quantity: number; unitCost: number }[];
    try {
      usages = buildProductUsages(store, tenantId, productId, productQuantity);
    } catch (error) {
      updateError = error instanceof SaleValidationError ? error.code : 'record-update-failed';
      return;
    }

    const price = service ? service.price : customPrice;
    const serviceName = service ? service.name : customServiceName;
    const commission = calculateCommission({
      service: service ? { commissionType: service.commissionType, commissionValue: service.commissionValue } : null,
      staff: { commissionType: staff.commissionType, commissionValue: staff.commissionValue },
      price,
    });

    // Phase 3: propagate to the co-written engine sale FIRST — a throw here
    // rolls back the legacy edit below (single atomic mutator). Legacy-only
    // rows no-op inside the amendment.
    amendEngineSaleForCorrection(storeAsCommerceStore(store), {
      tenantId,
      legacyRecordId: record.id,
      corrected: {
        price,
        serviceId: service?.id ?? null,
        serviceName,
        commissionType: commission.commissionType,
        commissionValue: commission.commissionValue,
        commissionAmount: commission.commissionAmount,
      },
      actorId: session.user.id,
      reason: correctionReason,
    });

    record.customerId = customer.id;
    record.staffId = staff.id;
    record.serviceId = service?.id ?? null;
    record.serviceName = serviceName;
    record.isCustomService = !service;
    record.price = price;
    record.description = description;
    record.commissionType = commission.commissionType;
    record.commissionValue = commission.commissionValue;
    record.commissionAmount = commission.commissionAmount;
    record.productUsages = usages;
    record.performedAt = performedAt ?? record.performedAt;
    record.correctedAt = new Date().toISOString();
    record.correctedBy = session.user.id;
  });
  } catch (error) {
    if (error instanceof CommerceError || error instanceof InventoryError) {
      redirect(`/app/sales?recordId=${recordId}&error=${error.code}`);
    }
    throw error;
  }

  if (updateError) {
    redirect(`/app/sales?recordId=${recordId}&error=${updateError}`);
  }

  touchShopPaths();
  revalidatePath(`/app/receipts/${recordId}`);
  redirect(redirectTo);
}

export async function deleteServiceRecordAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }

  const recordId = formString(formData, 'recordId');
  const reason = formString(formData, 'reason') || 'Duplicate or mistaken sale entry removed from the ledger.';

  // Phase 2: void the legacy row and its co-written engine sale (with stock
  // reversal) in the same mutator. Either side missing is benign; anything
  // else fails loudly rather than diverging.
  const result = await updateStore((store) => {
    const record = store.serviceRecords.find(
      (item) => item.id === recordId && item.tenantId === session.tenant!.id,
    );
    const voided = voidServiceRecord(store, {
      tenantId: session.tenant!.id,
      recordId,
      userId: session.user.id,
      reason,
    });

    if (voided.status !== 'missing' && record?.commerceSaleId) {
      try {
        voidSale(storeAsCommerceStore(store), {
          tenantId: session.tenant!.id,
          saleId: record.commerceSaleId,
          actorId: session.user.id,
          actorRole: session.user.role,
        });
      } catch (error) {
        if (!(error instanceof CommerceError && error.code === 'already-voided')) {
          throw error;
        }
      }
    }

    return voided;
  });

  if (result.status === 'missing') {
    redirect('/app/sales?error=record-missing');
  }

  touchShopPaths();
  if (result.nextRecordId) {
    redirect(`/app/sales?recordId=${result.nextRecordId}&success=record-deleted`);
  }

  redirect('/app/sales?success=record-deleted');
}

export async function addServiceAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) redirect('/super/tenants');
  const commissionType: 'fixed' | 'percentage' =
    formString(formData, 'commissionType') === 'fixed' ? 'fixed' : 'percentage';
  const serviceId = randomUUID();
  const imageFile = formData.get('imageFile');
  let imageUrl: string | null = null;

  try {
    imageUrl = imageFile instanceof File ? await storeServiceImage(imageFile, serviceId) : null;
  } catch {
    redirect('/app/services?error=image-upload');
  }

  let name: string;
  let price: number;
  let commissionValue: number;
  let durationMinutes: number | undefined;
  try {
    name = requireDisplayName(formString(formData, 'name'), 'name');
    price = parseMoneyInput(formString(formData, 'price'), 'price');
    commissionValue = parseOptionalMoneyInput(formString(formData, 'commissionValue'), 'commissionValue') ?? 0;
    const durationRaw = formString(formData, 'durationMinutes');
    const durationParsed = durationRaw ? parseProductQuantityInput(durationRaw, 'durationMinutes') : 0;
    durationMinutes = durationParsed > 0 ? durationParsed : undefined;
  } catch (error) {
    if (error instanceof SaleValidationError) {
      redirect(`/app/services?error=${error.code}`);
    }
    throw error;
  }

  await updateStore((store) => {
    store.services.push({
      id: serviceId,
      tenantId: session.tenant!.id,
      name,
      price,
      description: formString(formData, 'description'),
      imageUrl,
      commissionType,
      commissionValue,
      durationMinutes,
      isActive: true,
      createdBy: session.user.id,
      updatedBy: session.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  touchShopPaths();
  redirect('/app/services?success=added');
}

export async function updateServiceImageAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) redirect('/super/tenants');

  const serviceId = formString(formData, 'serviceId');
  const imageFile = formData.get('imageFile');
  let imageUrl: string | null = null;

  try {
    imageUrl = imageFile instanceof File ? await storeServiceImage(imageFile, serviceId) : null;
  } catch {
    redirect('/app/services?error=image-upload');
  }

  if (!imageUrl) {
    redirect('/app/services?error=image-upload');
  }

  await updateStore((store) => {
    const service = store.services.find((item) => item.id === serviceId && item.tenantId === session.tenant!.id);
    if (!service) {
      return;
    }

    service.imageUrl = imageUrl;
    service.updatedBy = session.user.id;
    service.updatedAt = new Date().toISOString();
  });

  touchShopPaths();
  redirect('/app/services?success=image-updated');
}

export async function addProductAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) redirect('/super/tenants');

  let validated: ReturnType<typeof validateProductInput>;
  let openingQuantity = 0;
  try {
    validated = validateProductInput({
      name: formString(formData, 'name'),
      description: formString(formData, 'description'),
      sku: formString(formData, 'sku'),
      unitCost: formString(formData, 'unitCost'),
      sellingPrice: formString(formData, 'sellingPrice'),
      reorderLevel: formString(formData, 'reorderLevel'),
      criticalLevel: formString(formData, 'criticalLevel'),
    });
    openingQuantity = parseProductQuantityInput(formString(formData, 'openingQuantity'), 'openingQuantity');
  } catch (error) {
    if (error instanceof SaleValidationError) {
      redirect(`/app/products?error=${error.code}`);
    }
    throw error;
  }

  const productId = randomUUID();
  try {
    await updateStore((store) => {
      ensureCatalogProjection(store);
      assertSkuUnique(store.products, session.tenant!.id, validated.sku);

      const now = new Date().toISOString();
      store.products.push({
        id: productId,
        tenantId: session.tenant!.id,
        name: validated.name,
        unitCost: validated.unitCost,
        description: validated.description,
        isActive: true,
        sku: validated.sku,
        skuGenerated: false,
        sellingPrice: validated.sellingPrice,
        quantityOnHand: 0,
        reorderLevel: validated.reorderLevel,
        criticalLevel: validated.criticalLevel,
        createdAt: now,
        updatedAt: now,
      });

      // Opening stock is a movement, never a bare number assignment.
      if (openingQuantity > 0) {
        postOpeningBalance(
          store,
          {
            tenantId: session.tenant!.id,
            productId,
            quantity: openingQuantity,
            unitCost: validated.unitCost,
            reason: 'Opening stock on product creation',
            createdBy: session.user.id,
          },
        );
      }
    });
  } catch (error) {
    if (error instanceof SaleValidationError) {
      redirect(`/app/products?error=${error.code}`);
    }
    if (error instanceof InventoryError) {
      redirect(`/app/products?error=${error.code}`);
    }
    throw error;
  }

  touchShopPaths();
  redirect('/app/products?success=added');
}

export async function updateProductAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) redirect('/super/tenants');

  const productId = formString(formData, 'productId');
  const redirectTo = `/app/products?productId=${productId}&success=updated`;

  let validated: ReturnType<typeof validateProductInput>;
  try {
    validated = validateProductInput({
      name: formString(formData, 'name'),
      description: formString(formData, 'description'),
      sku: formString(formData, 'sku'),
      unitCost: formString(formData, 'unitCost'),
      sellingPrice: formString(formData, 'sellingPrice'),
      reorderLevel: formString(formData, 'reorderLevel'),
      criticalLevel: formString(formData, 'criticalLevel'),
    });
  } catch (error) {
    if (error instanceof SaleValidationError) {
      redirect(`/app/products?productId=${productId}&error=${error.code}`);
    }
    throw error;
  }

  const isActive = formString(formData, 'isActive') !== 'false';

  let updateError: string | null = null;
  await updateStore((store) => {
    ensureCatalogProjection(store);
    const product = store.products.find((item) => item.id === productId && item.tenantId === session.tenant!.id);
    if (!product) {
      updateError = 'product-missing';
      return;
    }

    try {
      assertSkuUnique(store.products, session.tenant!.id, validated.sku, product.id);
    } catch (error) {
      updateError = error instanceof SaleValidationError ? error.code : 'product-update-failed';
      return;
    }

    product.name = validated.name;
    product.description = validated.description;
    product.unitCost = validated.unitCost;
    product.sku = validated.sku;
    product.sellingPrice = validated.sellingPrice;
    product.reorderLevel = validated.reorderLevel;
    product.criticalLevel = validated.criticalLevel;
    product.isActive = isActive;
    product.updatedAt = new Date().toISOString();
  });

  if (updateError) {
    redirect(`/app/products?productId=${productId}&error=${updateError}`);
  }

  touchShopPaths();
  redirect(redirectTo);
}

export async function adjustProductStockAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) redirect('/super/tenants');

  const productId = formString(formData, 'productId');
  const reason = formString(formData, 'reason');

  let countedQuantity = 0;
  try {
    countedQuantity = parseProductQuantityInput(formString(formData, 'countedQuantity'), 'countedQuantity');
    if (!productId) {
      redirect(`/app/products?productId=${productId}&error=missing-id`);
    }
    if (!reason) {
      redirect(`/app/products?productId=${productId}&error=adjustment-reason-required`);
    }
  } catch (error) {
    if (error instanceof SaleValidationError) {
      redirect(`/app/products?productId=${productId}&error=${error.code}`);
    }
    throw error;
  }

  try {
    await updateStore((store) => {
      ensureCatalogProjection(store);
      adjustProductStock(
        store,
        {
          tenantId: session.tenant!.id,
          productId,
          countedQuantity,
          reason,
          createdBy: session.user.id,
        },
      );
    });
  } catch (error) {
    if (error instanceof SaleValidationError || error instanceof InventoryError) {
      redirect(`/app/products?productId=${productId}&error=${error.code}`);
    }
    throw error;
  }

  touchShopPaths();
  redirect(`/app/products?productId=${productId}&success=adjusted`);
}

export async function updateServiceAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) redirect('/super/tenants');

  const serviceId = formString(formData, 'serviceId');
  const isActive = formString(formData, 'isActive') !== 'false';

  let validated: ReturnType<typeof validateServiceInput>;
  try {
    validated = validateServiceInput({
      name: formString(formData, 'name'),
      description: formString(formData, 'description'),
      price: formString(formData, 'price'),
      durationMinutes: formString(formData, 'durationMinutes'),
      commissionType: formString(formData, 'commissionType'),
      commissionValue: formString(formData, 'commissionValue'),
    });
  } catch (error) {
    if (error instanceof SaleValidationError) {
      redirect(`/app/services?error=${error.code}`);
    }
    throw error;
  }

  let updateError: string | null = null;
  await updateStore((store) => {
    const service = store.services.find((item) => item.id === serviceId && item.tenantId === session.tenant!.id);
    if (!service) {
      updateError = 'service-missing';
      return;
    }

    service.name = validated.name;
    service.description = validated.description;
    service.price = validated.price;
    service.durationMinutes = validated.durationMinutes;
    service.commissionType = validated.commissionType;
    service.commissionValue = validated.commissionValue;
    service.isActive = isActive;
    service.updatedBy = session.user.id;
    service.updatedAt = new Date().toISOString();
  });

  if (updateError) {
    redirect(`/app/services?error=${updateError}`);
  }

  touchShopPaths();
  redirect('/app/services?success=updated');
}

export async function setServiceConsumptionAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) redirect('/super/tenants');

  const serviceId = formString(formData, 'serviceId');

  // BOM editor submits one `bom_<productId>` quantity field per catalog row;
  // quantities above zero become consumption links. No JavaScript required.
  const lines: { productId: string; quantity: number }[] = [];
  try {
    for (const [key, value] of formData.entries()) {
      if (!key.startsWith('bom_') || typeof value !== 'string') {
        continue;
      }
      const productId = key.slice('bom_'.length);
      const quantity = value.trim() ? parseProductQuantityInput(value, `bom_${productId}`) : 0;
      if (quantity > 0) {
        lines.push({ productId, quantity });
      }
    }
  } catch (error) {
    if (error instanceof SaleValidationError) {
      redirect(`/app/services?error=${error.code}`);
    }
    throw error;
  }

  try {
    await updateStore((store) => {
      ensureCatalogProjection(store);
      replaceServiceBom(store, { tenantId: session.tenant!.id, serviceId, lines });
    });
  } catch (error) {
    if (error instanceof SaleValidationError || error instanceof InventoryError) {
      redirect(`/app/services?error=${error.code}`);
    }
    throw error;
  }

  touchShopPaths();
  redirect('/app/services?success=consumption-updated');
}

export async function addExpenseAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) redirect('/super/tenants');

  let category: string;
  let amount: number;
  let expenseDate: string;
  try {
    category = requireDisplayName(formString(formData, 'category'), 'category');
    amount = parseMoneyInput(formString(formData, 'amount'), 'amount', 'invalid-amount');
    expenseDate = parseExpenseDateInput(formString(formData, 'expenseDate'));
  } catch (error) {
    if (error instanceof SaleValidationError) {
      redirect(`/app/expenses?error=${error.code}`);
    }
    throw error;
  }

  const expenseId = randomUUID();
  await updateStore((store) => {
    store.expenses.push({
      id: expenseId,
      tenantId: session.tenant!.id,
      category,
      description: formString(formData, 'description'),
      amount,
      expenseDate,
      createdBy: session.user.id,
      createdAt: new Date().toISOString(),
    });
  });

  await recordAiEvent({
    tenantId: session.tenant!.id,
    event: 'expense.created',
    entityType: 'expense',
    entityId: expenseId,
    actorId: session.user.id,
    summary: `Expense ${category} recorded.`,
  });

  touchShopPaths();
  redirect('/app/expenses?success=added');
}

export async function queuePromotionAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) redirect('/super/tenants');
  const message = formString(formData, 'message');

  const queuedSmsIds = await updateStore((store) => {
    const recipients = store.customers.filter(
      (customer) =>
        customer.tenantId === session.tenant!.id &&
        customer.marketingOptIn &&
        !customer.archivedAt,
    );
    const smsIds: string[] = [];

    for (const customer of recipients) {
      const smsId = randomUUID();
      store.smsLogs.push({
        id: smsId,
        tenantId: session.tenant!.id,
        customerId: customer.id,
        smsType: 'promotion',
        recipientPhone: customer.phoneE164,
        message,
        status: 'queued',
        createdAt: new Date().toISOString(),
      });
      smsIds.push(smsId);
    }

    return smsIds;
  });

  await dispatchSmsLogs(queuedSmsIds);
  revalidatePath('/app/sms');
  redirect('/app/sms?success=queued');
}

export async function addMarketplaceAdAction(formData: FormData) {
  const session = await requireSession(['shop_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }

  const adId = randomUUID();
  const imageFile = formData.get('imageFile');
  let imageUrl: string | null = null;

  try {
    imageUrl = imageFile instanceof File ? await storeMarketplaceImage(imageFile, adId) : null;
  } catch {
    redirect('/app/marketplace?error=image-upload');
  }

  await updateStore((store) => {
    if (!ensurePlatinumTenant(store, session.tenant!.id)) {
      throw new Error('Marketplace is only available to platinum tenants.');
    }

    store.marketplaceAds.push({
      id: adId,
      tenantId: session.tenant!.id,
      title: formString(formData, 'title'),
      body: formString(formData, 'body'),
      contactName: formString(formData, 'contactName') || session.user.fullName,
      contactPhone: formString(formData, 'contactPhone') || session.user.phone || '',
      imageUrl,
      status: 'pending',
      approvalNotes: null,
      createdBy: session.user.id,
      approvedBy: null,
      approvedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  await recordAiEvent({
    tenantId: session.tenant!.id,
    event: 'marketplace.advert.created',
    entityType: 'marketplace_advert',
    entityId: adId,
    actorId: session.user.id,
    summary: 'Marketplace advert submitted for review.',
  });

  touchShopPaths();
  revalidatePath('/super/marketplace');
  redirect('/app/marketplace?success=submitted');
}

export async function reviewMarketplaceAdAction(formData: FormData) {
  const session = await requireSession(['super_admin']);
  const adId = formString(formData, 'adId');
  const decision = formString(formData, 'decision') === 'reject' ? 'rejected' : 'approved';
  const redirectTo = formString(formData, 'redirectTo') || `/super/marketplace?success=${decision}`;

  await updateStore((store) => {
    const ad = store.marketplaceAds.find((item) => item.id === adId);
    if (!ad) {
      return;
    }

    ad.status = decision;
    ad.approvalNotes = formNullableString(formData, 'approvalNotes');
    ad.approvedBy = session.user.id;
    ad.approvedAt = new Date().toISOString();
    ad.updatedAt = new Date().toISOString();
  });

  touchShopPaths();
  revalidatePath('/super/marketplace');
  revalidatePath('/super/tenants');
  redirect(redirectTo);
}

export async function addUserAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  const requestedTenantId = formString(formData, 'tenantId');
  const tenantId = session.user.role === 'super_admin' ? requestedTenantId : session.tenant?.id;
  const commissionType: 'fixed' | 'percentage' =
    formString(formData, 'commissionType') === 'fixed' ? 'fixed' : 'percentage';

  if (!tenantId) {
    redirect('/super/tenants');
  }

  const { hashPassword } = await import('@/server/store/passwords');
  const redirectBase = formString(formData, 'redirectTo');
  const redirectPath = redirectBase
    ? `${redirectBase}?success=user-added`
    : session.user.role === 'super_admin' ? '/super/tenants?success=user-added' : '/app/settings/staff?success=user-added';
  const errorPath = redirectBase
    ? `${redirectBase}?error=user-exists`
    : session.user.role === 'super_admin' ? '/super/tenants?error=user-exists' : '/app/settings/staff?error=user-exists';
  const invalidEmployeePath = redirectBase
    ? `${redirectBase}?error=invalid-employee-number`
    : session.user.role === 'super_admin'
      ? '/super/tenants?error=invalid-employee-number'
      : '/app/settings/staff?error=invalid-employee-number';
  const passwordRequiredPath = redirectBase
    ? `${redirectBase}?error=password-required`
    : session.user.role === 'super_admin'
      ? '/super/tenants?error=password-required'
      : '/app/settings/staff?error=password-required';
  const username = formString(formData, 'username');
  const email = formString(formData, 'email');
  const passwordText = formString(formData, 'password');
  const employeeNumberRaw = formString(formData, 'employeeNumber');
  const store = await readStore();
  const usernameExists = store.users.some(
    (user) => user.tenantId === tenantId && user.username.toLowerCase() === username.toLowerCase(),
  );
  const emailExists = store.users.some(
    (user) => user.tenantId === tenantId && user.email.toLowerCase() === email.toLowerCase(),
  );

  if (usernameExists || emailExists) {
    redirect(errorPath);
  }

  // Phase 2A: optional employee number, validated and unique per tenant.
  let employeeNumber: string | null = null;
  if (employeeNumberRaw) {
    try {
      employeeNumber = assertValidEmployeeNumber(normalizeEmployeeNumber(employeeNumberRaw));
    } catch {
      redirect(invalidEmployeePath);
    }
    const numberExists = store.users.some(
      (user) => user.tenantId === tenantId && (user.employeeNumber ?? '').toUpperCase() === employeeNumber,
    );
    if (numberExists) {
      redirect(invalidEmployeePath);
    }
  }

  if (!passwordText) {
    redirect(passwordRequiredPath);
  }

  await updateStore((store) => {
    store.users.push({
      id: randomUUID(),
      tenantId,
      role: formString(formData, 'role') === 'shop_admin' ? 'shop_admin' : 'staff',
      fullName: formString(formData, 'fullName'),
      username,
      email,
      phone: formString(formData, 'phone'),
      password: hashPassword(passwordText),
      passwordUpdatedAt: new Date().toISOString(),
      employeeNumber,
      isActive: true,
      commissionType,
      commissionValue: formNumber(formData, 'commissionValue'),
      commissionNotes: formString(formData, 'commissionNotes'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  touchShopPaths();
  revalidatePath('/super/tenants', 'layout');
  redirect(redirectPath);
}

export async function setUserPasswordAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  const userId = formString(formData, 'userId');
  const passwordText = formString(formData, 'password');
  const redirectTo =
    formString(formData, 'redirectTo') ||
    (session.user.role === 'super_admin'
      ? '/super/tenants?success=password-updated'
      : '/app/settings/staff?success=password-updated');

  if (!passwordText) {
    redirect(redirectTo.replace('success=password-updated', 'error=password-required'));
  }

  const { hashPassword } = await import('@/server/store/passwords');

  await updateStore((store) => {
    const target = store.users.find((user) => user.id === userId);
    if (!target || target.role === 'super_admin') {
      return;
    }

    if (session.user.role !== 'super_admin' && target.tenantId !== session.tenant?.id) {
      throw new Error('Cannot reset passwords outside your tenant.');
    }

    target.password = hashPassword(passwordText);
    target.passwordUpdatedAt = new Date().toISOString();
    target.updatedAt = new Date().toISOString();
  });

  touchShopPaths();
  revalidatePath('/super/tenants', 'layout');
  redirect(redirectTo);
}

export async function updateStaffTermsAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  const userId = formString(formData, 'userId');
  const commissionType: 'fixed' | 'percentage' =
    formString(formData, 'commissionType') === 'fixed' ? 'fixed' : 'percentage';

  await updateStore((store) => {
    const target = store.users.find((user) => user.id === userId);
    if (!target) {
      throw new Error('User not found.');
    }

    if (session.user.role !== 'super_admin' && target.tenantId !== session.tenant?.id) {
      throw new Error('Cannot edit staff outside your tenant.');
    }

    target.commissionType = commissionType;
    target.commissionValue = formNumber(formData, 'commissionValue');
    target.commissionNotes = formString(formData, 'commissionNotes');
    target.updatedAt = new Date().toISOString();
  });

  touchShopPaths();
  redirect('/app/settings/staff?success=updated');
}

export async function setUserStatusAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  const userId = formString(formData, 'userId');
  const nextStatus = formString(formData, 'nextStatus') === 'active';
  const redirectTo =
    formString(formData, 'redirectTo') ||
    (session.user.role === 'super_admin' ? '/super/tenants?success=user-status' : '/app/settings/staff?success=user-status');

  await updateStore((store) => {
    const target = store.users.find((user) => user.id === userId);
    if (!target || target.role === 'super_admin') {
      return;
    }

    if (session.user.role !== 'super_admin' && target.tenantId !== session.tenant?.id) {
      throw new Error('Cannot edit staff outside your tenant.');
    }

    target.isActive = nextStatus;
    target.updatedAt = new Date().toISOString();
  });

  touchShopPaths();
  revalidatePath('/super/tenants', 'layout');
  redirect(redirectTo);
}

export async function updateLoyaltySettingsAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }

  const redirectTo = formString(formData, 'redirectTo') || '/app/settings/loyalty?success=loyalty-saved';
  const isEnabled = formCheckbox(formData, 'isEnabled');
  const spendThreshold = formNumber(formData, 'spendThreshold');
  const rewardType = normalizeLoyaltyRewardType(formString(formData, 'rewardType'));
  const rewardValue = formNumber(formData, 'rewardValue');

  if (isEnabled && spendThreshold <= 0) {
    redirect(redirectTo.replace('success=loyalty-saved', 'error=threshold-required'));
  }

  if (isEnabled && rewardType === 'subsidized_service' && rewardValue <= 0) {
    redirect(redirectTo.replace('success=loyalty-saved', 'error=discount-required'));
  }

  await updateStore((store) => {
    const tenant = store.tenants.find((item) => item.id === session.tenant!.id);
    if (!tenant) {
      return;
    }

    tenant.loyaltyProgram = {
      isEnabled,
      spendThreshold: Math.max(0, spendThreshold),
      rewardType,
      rewardValue: Math.max(0, rewardValue),
      rewardLabel: formNullableString(formData, 'rewardLabel'),
      notes: formNullableString(formData, 'notes'),
    };
    tenant.updatedAt = new Date().toISOString();
  });

  touchShopPaths();
  revalidatePath(`/book/${session.tenant.slug}`);
  redirect(redirectTo);
}

export async function updateCustomerAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  const customerId = formString(formData, 'customerId');
  const redirectTo =
    formString(formData, 'redirectTo') ||
    (session.user.role === 'super_admin'
      ? '/super/tenants?success=customer-updated'
      : '/app/customers?success=customer-updated');

  await updateStore((store) => {
    const target = store.customers.find((customer) => customer.id === customerId);
    if (!target) {
      return;
    }

    if (session.user.role !== 'super_admin' && target.tenantId !== session.tenant?.id) {
      throw new Error('Cannot edit customers outside your tenant.');
    }

    target.name = formString(formData, 'name') || target.name;
    target.phone = formString(formData, 'phone') || target.phone;
    target.phoneE164 = formString(formData, 'phoneE164') || target.phoneE164;
    target.notes = formString(formData, 'notes') || target.notes;
    target.marketingOptIn = formString(formData, 'marketingOptIn') === 'on';
    target.updatedAt = new Date().toISOString();
  });

  touchShopPaths();
  revalidatePath('/super/tenants');
  redirect(redirectTo);
}

export async function addCustomerAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }

  const redirectBase = session.user.role === 'super_admin' ? '/super/tenants' : '/app/customers';
  const name = formString(formData, 'name');
  const phone = normalizePhoneInput(formString(formData, 'phone') || formString(formData, 'phoneE164'));
  const notes = formString(formData, 'notes');
  const marketingOptIn = formCheckbox(formData, 'marketingOptIn');

  if (!name || !phone) {
    redirect(`${redirectBase}?error=customer-required`);
  }

  const result = await updateStore((store) => {
    const existing = store.customers.find(
      (customer) =>
        customer.tenantId === session.tenant!.id &&
        normalizePhoneLookup(customer.phoneE164 || customer.phone) === normalizePhoneLookup(phone),
    );

    if (existing && !existing.archivedAt) {
      return { status: 'duplicate' as const };
    }

    const now = new Date().toISOString();

    if (existing && existing.archivedAt) {
      existing.name = name;
      existing.phone = phone;
      existing.phoneE164 = phone;
      existing.notes = notes || existing.notes;
      existing.marketingOptIn = marketingOptIn;
      existing.archivedAt = null;
      existing.updatedAt = now;
      return { status: 'restored' as const };
    }

    store.customers.push({
      id: randomUUID(),
      tenantId: session.tenant!.id,
      name,
      phone,
      phoneE164: phone,
      notes: notes || undefined,
      marketingOptIn,
      createdAt: now,
      updatedAt: now,
    });

    return { status: 'added' as const };
  });

  touchShopPaths();
  revalidatePath('/super/tenants');

  if (result.status === 'duplicate') {
    redirect(`${redirectBase}?error=customer-exists`);
  }

  redirect(`${redirectBase}?success=${result.status === 'restored' ? 'customer-restored' : 'customer-added'}`);
}

export async function archiveCustomerAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  const customerId = formString(formData, 'customerId');
  const redirectTo =
    formString(formData, 'redirectTo') ||
    (session.user.role === 'super_admin'
      ? '/super/tenants?success=customer-archived'
      : '/app/customers?success=customer-archived');

  await updateStore((store) => {
    const target = store.customers.find((customer) => customer.id === customerId);
    if (!target) {
      return;
    }

    if (session.user.role !== 'super_admin' && target.tenantId !== session.tenant?.id) {
      throw new Error('Cannot archive customers outside your tenant.');
    }

    target.archivedAt = new Date().toISOString();
    target.updatedAt = new Date().toISOString();
  });

  touchShopPaths();
  revalidatePath('/super/tenants');
  redirect(redirectTo);
}

export async function addSubscriptionPackageAction(formData: FormData) {
  await requireSession(['super_admin']);

  const name = formString(formData, 'name');
  const code = normalizePlanCode(formString(formData, 'code') || name);
  const redirectBase = formString(formData, 'redirectTo') || '/super/tenants';

  if (!name || !code) {
    redirect(`${redirectBase}?error=package-required`);
  }

  const existing = await readStore();
  const duplicate = existing.subscriptionPackages.some(
    (item) => item.code === code || item.name.toLowerCase() === name.toLowerCase(),
  );

  if (duplicate) {
    redirect(`${redirectBase}?error=package-exists`);
  }

  const now = new Date().toISOString();
  const includesMarketplace = formCheckbox(formData, 'includesMarketplace');
  const includesCustomerMarketplace = formCheckbox(formData, 'includesCustomerMarketplace') || includesMarketplace;
  const isActive = formCheckbox(formData, 'isActive');

  await updateStore((store) => {
    store.subscriptionPackages.push({
      id: randomUUID(),
      code,
      name,
      description: formNullableString(formData, 'description'),
      features: parseFeatureLines(formData, 'features'),
      amount: formNumber(formData, 'amount'),
      currencyCode: formString(formData, 'currencyCode') || 'KES',
      billingPeriod: normalizeBillingPeriod(formString(formData, 'billingPeriod')),
      includesMarketplace,
      includesCustomerMarketplace,
      isActive,
      createdAt: now,
      updatedAt: now,
    });
  });

  revalidatePath('/super/tenants', 'layout');
  touchShopPaths();
  redirect(`${redirectBase}?success=package-added`);
}

export async function updateSubscriptionPackageAction(formData: FormData) {
  await requireSession(['super_admin']);

  const packageId = formString(formData, 'packageId');
  const name = formString(formData, 'name');
  const code = normalizePlanCode(formString(formData, 'code') || name);
  const redirectBase = formString(formData, 'redirectTo') || '/super/tenants';

  if (!packageId || !name || !code) {
    redirect(`${redirectBase}?error=package-required`);
  }

  const existing = await readStore();
  const duplicate = existing.subscriptionPackages.some(
    (item) => item.id !== packageId && (item.code === code || item.name.toLowerCase() === name.toLowerCase()),
  );

  if (duplicate) {
    redirect(`${redirectBase}?error=package-exists`);
  }

  const includesMarketplace = formCheckbox(formData, 'includesMarketplace');
  const includesCustomerMarketplace = formCheckbox(formData, 'includesCustomerMarketplace') || includesMarketplace;

  await updateStore((store) => {
    const target = store.subscriptionPackages.find((item) => item.id === packageId);
    if (!target) {
      return;
    }

    target.code = code;
    target.name = name;
    target.description = formNullableString(formData, 'description');
    target.features = parseFeatureLines(formData, 'features');
    target.amount = formNumber(formData, 'amount');
    target.currencyCode = formString(formData, 'currencyCode') || target.currencyCode || 'KES';
    target.billingPeriod = normalizeBillingPeriod(formString(formData, 'billingPeriod'));
    target.includesMarketplace = includesMarketplace;
    target.includesCustomerMarketplace = includesCustomerMarketplace;
    target.isActive = formCheckbox(formData, 'isActive');
    target.updatedAt = new Date().toISOString();

    for (const subscription of store.subscriptions) {
      if (subscription.packageId === packageId) {
        subscription.planCode = code;
        subscription.updatedAt = new Date().toISOString();
      }
    }
  });

  revalidatePath('/super/tenants', 'layout');
  touchShopPaths();
  redirect(`${redirectBase}?success=package-updated`);
}

export async function updateTenantSubscriptionAction(formData: FormData) {
  await requireSession(['super_admin']);
  const tenantId = formString(formData, 'tenantId');
  const endsAt = formDateTimeString(formData, 'endsAt');
  const startsAt = formDateTimeString(formData, 'startsAt');
  const status = formString(formData, 'status');
  const amountRaw = formString(formData, 'amount');
  const redirectBase = formString(formData, 'redirectTo') || '/super/tenants';

  await updateStore((store) => {
    const tenant = store.tenants.find((item) => item.id === tenantId);
    const subscription = store.subscriptions.find((item) => item.tenantId === tenantId);
    const selectedPackage = resolveSubscriptionPackage(store, formData, subscription?.planCode ?? 'basic');

    if (!tenant || !subscription || !selectedPackage) {
      return;
    }

    tenant.status = status === 'suspended' ? 'suspended' : 'active';
    tenant.suspensionReason =
      status === 'suspended' ? formString(formData, 'suspensionReason') || tenant.suspensionReason || 'Suspended by super admin' : null;
    tenant.updatedAt = new Date().toISOString();

    subscription.packageId = selectedPackage.id;
    subscription.planCode = selectedPackage.code;
    subscription.status =
      status === 'trialing' ||
      status === 'active' ||
      status === 'past_due' ||
      status === 'expired' ||
      status === 'suspended' ||
      status === 'cancelled'
        ? status
        : subscription.status;
    subscription.startsAt = startsAt ?? subscription.startsAt;
    subscription.endsAt = endsAt ?? subscription.endsAt;
    subscription.amount = amountRaw ? Number(amountRaw) : selectedPackage.amount;
    subscription.currencyCode = formString(formData, 'currencyCode') || selectedPackage.currencyCode || subscription.currencyCode;
    subscription.autoRenew = formCheckbox(formData, 'autoRenew');
    subscription.paymentTerms = formNullableString(formData, 'paymentTerms') ?? undefined;
    subscription.updatedAt = new Date().toISOString();
  });

  revalidatePath('/super/tenants', 'layout');
  touchShopPaths();
  redirect(`${redirectBase}?success=subscription-updated`);
}

export async function addTenantAction(formData: FormData) {
  await requireSession(['super_admin']);
  const slug = formString(formData, 'slug');
  const existing = await readStore();
  const tenantId = randomUUID();
  const now = new Date().toISOString();
  const logoFile = formData.get('logoFile');
  const selectedPackage = resolveSubscriptionPackage(existing, formData, 'basic');
  const endsAt =
    formDateTimeString(formData, 'endsAt') ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString();
  const amountRaw = formString(formData, 'amount');
  const redirectBase = formString(formData, 'redirectTo') || '/super/tenants';

  if (existing.tenants.some((tenant) => tenant.slug.toLowerCase() === slug.toLowerCase())) {
    redirect(`${redirectBase}?error=tenant-exists`);
  }

  let uploadedLogoUrl: string | null = null;
  try {
    uploadedLogoUrl = logoFile instanceof File ? await storeTenantLogo(logoFile, tenantId) : null;
  } catch {
    redirect(`${redirectBase}?error=logo-upload`);
  }

  await updateStore((store) => {
    store.tenants.push({
      id: tenantId,
      name: formString(formData, 'name'),
      ownerName: formString(formData, 'ownerName') || null,
      slug,
      logoUrl: uploadedLogoUrl,
      motto: formNullableString(formData, 'motto'),
      address: formNullableString(formData, 'address'),
      storeNumber: formNullableString(formData, 'storeNumber'),
      timezone: formString(formData, 'timezone') || 'Africa/Nairobi',
      countryCode: 'KE',
      currencyCode: formString(formData, 'currencyCode') || 'KES',
      status: 'active',
      loyaltyProgram: {
        isEnabled: false,
        spendThreshold: 10000,
        rewardType: 'free_service',
        rewardValue: 0,
        rewardLabel: 'Complimentary service',
        notes: null,
      },
      createdAt: now,
      updatedAt: now,
    });
    store.subscriptions.push({
      id: randomUUID(),
      tenantId,
      packageId: selectedPackage?.id ?? null,
      planCode: selectedPackage?.code ?? normalizePlanCode(formString(formData, 'planCode') || 'basic'),
      status: 'active',
      startsAt: now,
      endsAt,
      amount: amountRaw ? Number(amountRaw) : selectedPackage?.amount || 0,
      currencyCode: formString(formData, 'currencyCode') || selectedPackage?.currencyCode || 'KES',
      autoRenew: formCheckbox(formData, 'autoRenew'),
      paymentTerms: formString(formData, 'paymentTerms'),
      updatedAt: now,
    });
  });

  revalidatePath('/super/tenants', 'layout');
  redirect(`${redirectBase}?success=tenant-added&tenantId=${tenantId}`);
}

export async function updateTenantBrandingAction(formData: FormData) {
  await requireSession(['super_admin']);
  const tenantId = formString(formData, 'tenantId');
  const logoFile = formData.get('logoFile');
  const removeLogo = formString(formData, 'removeLogo') === 'on';
  const redirectBase = formString(formData, 'redirectTo') || '/super/tenants';

  let uploadedLogoUrl: string | null = null;
  try {
    uploadedLogoUrl = logoFile instanceof File ? await storeTenantLogo(logoFile, tenantId) : null;
  } catch {
    redirect(`${redirectBase}?error=logo-upload`);
  }

  await updateStore((store) => {
    const tenant = store.tenants.find((item) => item.id === tenantId);
    if (!tenant) {
      return;
    }

    tenant.name = formString(formData, 'name') || tenant.name;
    tenant.ownerName = formNullableString(formData, 'ownerName');
    tenant.logoUrl = uploadedLogoUrl ?? (removeLogo ? null : tenant.logoUrl ?? null);
    tenant.motto = formNullableString(formData, 'motto');
    tenant.address = formNullableString(formData, 'address');
    tenant.storeNumber = formNullableString(formData, 'storeNumber');
    tenant.updatedAt = new Date().toISOString();
  });

  revalidatePath('/super/tenants', 'layout');
  touchShopPaths();
  redirect(`${redirectBase}?success=branding-updated`);
}

export async function suspendTenantAction(formData: FormData) {
  await requireSession(['super_admin']);
  const tenantId = formString(formData, 'tenantId');
  const reason = formString(formData, 'reason');
  const redirectBase = formString(formData, 'redirectTo') || '/super/tenants';

  await updateStore((store) => {
    const tenant = store.tenants.find((item) => item.id === tenantId);
    if (tenant) {
      tenant.status = 'suspended';
      tenant.suspensionReason = reason || 'Suspended by super admin';
      tenant.updatedAt = new Date().toISOString();
    }

    const subscription = store.subscriptions.find((item) => item.tenantId === tenantId);
    if (subscription) {
      subscription.status = 'suspended';
      subscription.updatedAt = new Date().toISOString();
    }
  });

  revalidatePath('/super/tenants', 'layout');
  redirect(`${redirectBase}?success=suspended`);
}

export async function clearTenantCustomersAction(formData: FormData) {
  await requireSession(['super_admin']);
  const tenantId = formString(formData, 'tenantId');
  const redirectBase = formString(formData, 'redirectTo') || '/super/tenants';

  await updateStore((store) => {
    store.customers = store.customers.filter((item) => item.tenantId !== tenantId);
    store.customerOrders = store.customerOrders.filter((item) => item.tenantId !== tenantId);
    store.serviceRecords = store.serviceRecords.filter((item) => item.tenantId !== tenantId);
    store.smsLogs = store.smsLogs.filter((item) => item.tenantId !== tenantId);
    store.expenses = store.expenses.filter((item) => item.tenantId !== tenantId);
    store.commissionPayouts = store.commissionPayouts.filter((item) => item.tenantId !== tenantId);
    store.customerSessions = store.customerSessions.filter((item) => item.tenantId !== tenantId);
  });

  revalidatePath('/super/tenants', 'layout');
  touchShopPaths();
  redirect(`${redirectBase}?success=cleared`);
}
