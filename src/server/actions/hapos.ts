'use server';

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { isPlatinumPlan, normalizePlanCode } from '@/lib/plans';
import { getAccessState } from '@/server/auth/access';
import { signInCustomerSession, signOutCustomerSession } from '@/server/auth/customer-session';
import { requireSession, signInSession, signOutSession } from '@/server/auth/demo-session';
import { calculateCommission } from '@/server/services/app-data';
import { dispatchSmsLogs } from '@/server/services/sms';
import { authenticateCustomer, authenticateUser, readStore, updateStore } from '@/server/store';
import type { StoreState } from '@/server/store/types';

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

function getImageExtension(file: File) {
  const ext = path.extname(file.name || '').toLowerCase();
  if (ext) {
    return ext;
  }

  if (file.type === 'image/png') return '.png';
  if (file.type === 'image/jpeg') return '.jpg';
  if (file.type === 'image/webp') return '.webp';
  if (file.type === 'image/svg+xml') return '.svg';
  return '.png';
}

async function storeUploadedImage(file: File | null, folderName: string, prefix: string) {
  if (!file || file.size === 0) {
    return null;
  }

  if (!file.type.startsWith('image/')) {
    throw new Error('Uploads must be image files.');
  }

  const uploadsDir = path.join(process.cwd(), 'public', 'uploads', folderName);
  await mkdir(uploadsDir, { recursive: true });

  const filename = `${prefix}-${Date.now()}${getImageExtension(file)}`;
  const outputPath = path.join(uploadsDir, filename);
  const bytes = Buffer.from(await file.arrayBuffer());

  await writeFile(outputPath, bytes);
  return `/uploads/${folderName}/${filename}`;
}

async function storeTenantLogo(file: File | null, tenantId: string) {
  return storeUploadedImage(file, 'logos', tenantId);
}

async function storeServiceImage(file: File | null, serviceId: string) {
  return storeUploadedImage(file, 'services', serviceId);
}

async function storeMarketplaceImage(file: File | null, adId: string) {
  return storeUploadedImage(file, 'marketplace', adId);
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
  const tenantProducts = store.products.filter((product) => product.tenantId === tenantId);

  if (!productId || productQuantity <= 0) {
    return [];
  }

  const product = tenantProducts.find((item) => item.id === productId);
  return product ? [{ productId, quantity: productQuantity, unitCost: product.unitCost }] : [];
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
      redirect(`/blocked?reason=${accessState.reason}`);
    }
  }

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
      requestedStaffId: staff?.id ?? null,
      requestedName: customer.name,
      requestedPhone: customer.phoneE164 || customer.phone,
      notes: notes || undefined,
      status: 'pending',
      requestedAt: now,
      statusUpdatedAt: null,
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

export async function recordServiceAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);
  if (!session.tenant) {
    redirect('/super/tenants');
  }

  const customerName = formString(formData, 'customerName');
  const customerPhone = normalizePhoneInput(formString(formData, 'customerPhone'));
  const serviceMode = formString(formData, 'serviceMode');
  const selectedServiceId = formString(formData, 'serviceId');
  const customServiceName = formString(formData, 'customServiceName');
  const customPrice = formNumber(formData, 'customPrice');
  const staffId = session.user.role === 'staff' ? session.user.id : formString(formData, 'staffId');
  const description = formString(formData, 'description');
  const productId = formString(formData, 'productId');
  const productQuantity = formNumber(formData, 'productQuantity');

  if (!customerName || !customerPhone) {
    redirect('/app/service-entry?error=customer-required');
  }

  if (serviceMode === 'custom' && (!customServiceName || customPrice <= 0)) {
    redirect('/app/service-entry?error=custom-service');
  }

  const result = await updateStore((store) => {
    const tenantId = session.tenant!.id;
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

    const usages = buildProductUsages(store, tenantId, productId, productQuantity);

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
      performedAt: new Date().toISOString(),
      recordedBy: session.user.id,
      correctedAt: null,
      correctedBy: null,
      createdAt: new Date().toISOString(),
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

    return { ok: true as const, smsIds: [smsId] };
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
  const customerName = formString(formData, 'customerName');
  const customerPhone = formString(formData, 'customerPhone');
  const serviceMode = formString(formData, 'serviceMode');
  const selectedServiceId = formString(formData, 'serviceId');
  const customServiceName = formString(formData, 'customServiceName');
  const customPrice = formNumber(formData, 'customPrice');
  const staffId = formString(formData, 'staffId');
  const description = formString(formData, 'description');
  const productId = formString(formData, 'productId');
  const productQuantity = formNumber(formData, 'productQuantity');
  const performedAtRaw = formString(formData, 'performedAt');
  const performedAt = formDateTimeString(formData, 'performedAt');

  if (!tenantId) {
    redirect('/super/tenants');
  }

  if (performedAtRaw && !performedAt) {
    redirect(`/app/sales?recordId=${recordId}&error=invalid-date`);
  }

  if (serviceMode === 'custom' && (!customServiceName || customPrice <= 0)) {
    redirect(`/app/sales?recordId=${recordId}&error=custom-service`);
  }

  await updateStore((store) => {
    const record = store.serviceRecords.find((item) => item.id === recordId && item.tenantId === tenantId);
    if (!record) {
      throw new Error('Service record not found.');
    }

    const tenantUsers = store.users.filter((user) => user.tenantId === tenantId);
    const tenantServices = store.services.filter((service) => service.tenantId === tenantId);
    const staff = tenantUsers.find((user) => user.id === staffId);
    if (!staff) {
      throw new Error('Staff member not found for this tenant.');
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
      throw new Error('Selected service is not available for this tenant.');
    }

    const price = service ? service.price : customPrice;
    const serviceName = service ? service.name : customServiceName;
    const commission = calculateCommission({
      service: service ? { commissionType: service.commissionType, commissionValue: service.commissionValue } : null,
      staff: { commissionType: staff.commissionType, commissionValue: staff.commissionValue },
      price,
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
    record.productUsages = buildProductUsages(store, tenantId, productId, productQuantity);
    record.performedAt = performedAt ?? record.performedAt;
    record.correctedAt = new Date().toISOString();
    record.correctedBy = session.user.id;
  });

  touchShopPaths();
  revalidatePath(`/app/receipts/${recordId}`);
  redirect(redirectTo);
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

  await updateStore((store) => {
    store.services.push({
      id: serviceId,
      tenantId: session.tenant!.id,
      name: formString(formData, 'name'),
      price: formNumber(formData, 'price'),
      description: formString(formData, 'description'),
      imageUrl,
      commissionType,
      commissionValue: formNumber(formData, 'commissionValue'),
      durationMinutes: formNumber(formData, 'durationMinutes') || undefined,
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

  await updateStore((store) => {
    store.products.push({
      id: randomUUID(),
      tenantId: session.tenant!.id,
      name: formString(formData, 'name'),
      unitCost: formNumber(formData, 'unitCost'),
      description: formString(formData, 'description'),
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  touchShopPaths();
  redirect('/app/products?success=added');
}

export async function addExpenseAction(formData: FormData) {
  const session = await requireSession(['shop_admin', 'super_admin']);
  if (!session.tenant) redirect('/super/tenants');

  await updateStore((store) => {
    store.expenses.push({
      id: randomUUID(),
      tenantId: session.tenant!.id,
      category: formString(formData, 'category'),
      description: formString(formData, 'description'),
      amount: formNumber(formData, 'amount'),
      expenseDate: formString(formData, 'expenseDate'),
      createdBy: session.user.id,
      createdAt: new Date().toISOString(),
    });
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
  const redirectPath =
    session.user.role === 'super_admin' ? '/super/tenants?success=user-added' : '/app/settings/staff?success=user-added';
  const errorPath =
    session.user.role === 'super_admin' ? '/super/tenants?error=user-exists' : '/app/settings/staff?error=user-exists';
  const username = formString(formData, 'username');
  const email = formString(formData, 'email');
  const passwordText = formString(formData, 'password');
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

  if (!passwordText) {
    redirect(
      session.user.role === 'super_admin'
        ? '/super/tenants?error=password-required'
        : '/app/settings/staff?error=password-required',
    );
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
      isActive: true,
      commissionType,
      commissionValue: formNumber(formData, 'commissionValue'),
      commissionNotes: formString(formData, 'commissionNotes'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  touchShopPaths();
  revalidatePath('/super/tenants');
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
  revalidatePath('/super/tenants');
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
  revalidatePath('/super/tenants');
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

  if (!name || !code) {
    redirect('/super/tenants?error=package-required');
  }

  const existing = await readStore();
  const duplicate = existing.subscriptionPackages.some(
    (item) => item.code === code || item.name.toLowerCase() === name.toLowerCase(),
  );

  if (duplicate) {
    redirect('/super/tenants?error=package-exists');
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

  revalidatePath('/super/tenants');
  touchShopPaths();
  redirect('/super/tenants?success=package-added');
}

export async function updateSubscriptionPackageAction(formData: FormData) {
  await requireSession(['super_admin']);

  const packageId = formString(formData, 'packageId');
  const name = formString(formData, 'name');
  const code = normalizePlanCode(formString(formData, 'code') || name);

  if (!packageId || !name || !code) {
    redirect('/super/tenants?error=package-required');
  }

  const existing = await readStore();
  const duplicate = existing.subscriptionPackages.some(
    (item) => item.id !== packageId && (item.code === code || item.name.toLowerCase() === name.toLowerCase()),
  );

  if (duplicate) {
    redirect('/super/tenants?error=package-exists');
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

  revalidatePath('/super/tenants');
  touchShopPaths();
  redirect('/super/tenants?success=package-updated');
}

export async function updateTenantSubscriptionAction(formData: FormData) {
  await requireSession(['super_admin']);
  const tenantId = formString(formData, 'tenantId');
  const endsAt = formDateTimeString(formData, 'endsAt');
  const startsAt = formDateTimeString(formData, 'startsAt');
  const status = formString(formData, 'status');
  const amountRaw = formString(formData, 'amount');

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

  revalidatePath('/super/tenants');
  touchShopPaths();
  redirect('/super/tenants?success=subscription-updated');
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

  if (existing.tenants.some((tenant) => tenant.slug.toLowerCase() === slug.toLowerCase())) {
    redirect('/super/tenants?error=tenant-exists');
  }

  let uploadedLogoUrl: string | null = null;
  try {
    uploadedLogoUrl = logoFile instanceof File ? await storeTenantLogo(logoFile, tenantId) : null;
  } catch {
    redirect('/super/tenants?error=logo-upload');
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

  revalidatePath('/super/tenants');
  redirect('/super/tenants?success=tenant-added');
}

export async function updateTenantBrandingAction(formData: FormData) {
  await requireSession(['super_admin']);
  const tenantId = formString(formData, 'tenantId');
  const logoFile = formData.get('logoFile');
  const removeLogo = formString(formData, 'removeLogo') === 'on';

  let uploadedLogoUrl: string | null = null;
  try {
    uploadedLogoUrl = logoFile instanceof File ? await storeTenantLogo(logoFile, tenantId) : null;
  } catch {
    redirect('/super/tenants?error=logo-upload');
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

  revalidatePath('/super/tenants');
  touchShopPaths();
  redirect('/super/tenants?success=branding-updated');
}

export async function suspendTenantAction(formData: FormData) {
  await requireSession(['super_admin']);
  const tenantId = formString(formData, 'tenantId');
  const reason = formString(formData, 'reason');

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

  revalidatePath('/super/tenants');
  redirect('/super/tenants?success=suspended');
}

export async function renewTenantAction(formData: FormData) {
  await requireSession(['super_admin']);
  const tenantId = formString(formData, 'tenantId');
  const endsAt = formString(formData, 'endsAt');
  const paymentTerms = formString(formData, 'paymentTerms');

  await updateStore((store) => {
    const tenant = store.tenants.find((item) => item.id === tenantId);
    if (tenant) {
      tenant.status = 'active';
      tenant.suspensionReason = null;
      tenant.updatedAt = new Date().toISOString();
    }

    const subscription = store.subscriptions.find((item) => item.tenantId === tenantId);
    if (subscription) {
      subscription.status = 'active';
      subscription.endsAt = endsAt || subscription.endsAt;
      subscription.paymentTerms = paymentTerms || subscription.paymentTerms;
      subscription.updatedAt = new Date().toISOString();
    }
  });

  revalidatePath('/super/tenants');
  redirect('/super/tenants?success=renewed');
}

export async function renameTenantAction(formData: FormData) {
  await requireSession(['super_admin']);
  const tenantId = formString(formData, 'tenantId');
  const name = formString(formData, 'name');

  await updateStore((store) => {
    const tenant = store.tenants.find((item) => item.id === tenantId);
    if (tenant) {
      tenant.name = name;
      tenant.updatedAt = new Date().toISOString();
    }
  });

  revalidatePath('/super/tenants');
  redirect('/super/tenants?success=renamed');
}

export async function clearTenantCustomersAction(formData: FormData) {
  await requireSession(['super_admin']);
  const tenantId = formString(formData, 'tenantId');

  await updateStore((store) => {
    store.customers = store.customers.filter((item) => item.tenantId !== tenantId);
    store.customerOrders = store.customerOrders.filter((item) => item.tenantId !== tenantId);
    store.serviceRecords = store.serviceRecords.filter((item) => item.tenantId !== tenantId);
    store.smsLogs = store.smsLogs.filter((item) => item.tenantId !== tenantId);
    store.expenses = store.expenses.filter((item) => item.tenantId !== tenantId);
    store.commissionPayouts = store.commissionPayouts.filter((item) => item.tenantId !== tenantId);
    store.customerSessions = store.customerSessions.filter((item) => item.tenantId !== tenantId);
  });

  revalidatePath('/super/tenants');
  touchShopPaths();
  redirect('/super/tenants?success=cleared');
}
