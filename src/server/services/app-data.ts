import type {
  AppSession,
  CommissionPayout,
  CommissionType,
  CustomerOrder,
  Customer,
  DashboardSummary,
  Expense,
  LoyaltyProgram,
  FinancialRow,
  MarketplaceAd,
  MonthlyContributionPoint,
  MonthlyReport,
  Product,
  Service,
  ServiceRecord,
  SmsLog,
  StaffMetrics,
  StaffPerformance,
  Subscription,
  SubscriptionPackage,
  Tenant,
  User,
} from '@/lib/types';
import { subscriptionIncludesMarketplace } from '@/lib/plans';
import { formatCurrency } from '@/lib/format';
import { getAccessState } from '@/server/auth/access';
import {
  getSubscriptionForTenant,
  listAllCustomersByTenant,
  listCommissionPayoutsByTenant,
  listCustomersByTenant,
  listExpensesByTenant,
  listProductsByTenant,
  listRecordsByTenant,
  listServicesByTenant,
  listSmsLogsByTenant,
  listSubscriptionPackagesStore,
  listSubscriptionsStore,
  listTenantsStore,
  listUsersByTenant,
  readStore,
} from '@/server/store';

function sameUtcDay(iso: string, now: Date) {
  const date = new Date(iso);
  return (
    date.getUTCFullYear() === now.getUTCFullYear() &&
    date.getUTCMonth() === now.getUTCMonth() &&
    date.getUTCDate() === now.getUTCDate()
  );
}

function sameUtcMonth(iso: string, now: Date) {
  const date = new Date(iso);
  return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth();
}

function startOfMonthLabel(value: Date) {
  return value.toLocaleString('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function addUtcMonths(value: Date, delta: number) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + delta, 1));
}

function getProductCost(record: ServiceRecord) {
  return (record.productUsages ?? []).reduce((sum, usage) => sum + usage.totalCost, 0);
}

function buildMonthlyContribution(records: ServiceRecord[], now: Date, monthCount = 6): MonthlyContributionPoint[] {
  return Array.from({ length: monthCount }, (_, index) => {
    const targetMonth = addUtcMonths(now, -index);
    const monthRecords = records.filter((record) => sameUtcMonth(record.performedAt, targetMonth));

    return {
      monthKey: `${targetMonth.getUTCFullYear()}-${String(targetMonth.getUTCMonth() + 1).padStart(2, '0')}`,
      monthLabel: startOfMonthLabel(targetMonth),
      revenue: monthRecords.reduce((sum, record) => sum + record.price, 0),
      commission: monthRecords.reduce((sum, record) => sum + record.commission, 0),
      services: monthRecords.length,
      clients: new Set(monthRecords.map((record) => record.customerId)).size,
    };
  });
}

function buildStaffPerformance(users: User[], records: ServiceRecord[]): StaffPerformance[] {
  return users
    .filter((user) => user.role === 'staff' || user.role === 'shop_admin')
    .map((user) => {
      const rows = records.filter((record) => record.staffId === user.id);
      return {
        staffId: user.id,
        staffName: user.fullName,
        totalServices: rows.length,
        totalRevenue: rows.reduce((sum, row) => sum + row.price, 0),
        totalCommission: rows.reduce((sum, row) => sum + row.commission, 0),
        clientCount: new Set(rows.map((row) => row.customerId)).size,
      };
    })
    .sort((a, b) => b.totalRevenue - a.totalRevenue);
}

function mapMarketplaceAd(
  store: Awaited<ReturnType<typeof readStore>>,
  ad: (Awaited<ReturnType<typeof readStore>>)['marketplaceAds'][number],
  currentTenantId?: string,
): MarketplaceAd {
  const tenant = store.tenants.find((item) => item.id === ad.tenantId);
  const createdBy = store.users.find((user) => user.id === ad.createdBy);
  const approvedBy = ad.approvedBy ? store.users.find((user) => user.id === ad.approvedBy) : null;

  return {
    id: ad.id,
    tenantId: ad.tenantId,
    tenantName: tenant?.name ?? 'Unknown business',
    tenantSlug: tenant?.slug ?? 'unknown',
    tenantLogoUrl: tenant?.logoUrl ?? null,
    title: ad.title,
    body: ad.body,
    contactName: ad.contactName || createdBy?.fullName || 'Shop admin',
    contactPhone: ad.contactPhone,
    imageUrl: ad.imageUrl ?? null,
    status: ad.status,
    approvalNotes: ad.approvalNotes ?? null,
    createdAt: ad.createdAt,
    approvedAt: ad.approvedAt ?? null,
    createdByName: createdBy?.fullName ?? 'Shop admin',
    approvedByName: approvedBy?.fullName ?? null,
    isOwnAd: currentTenantId ? ad.tenantId === currentTenantId : false,
  };
}

function mapCustomerOrder(
  store: Awaited<ReturnType<typeof readStore>>,
  order: (Awaited<ReturnType<typeof readStore>>)['customerOrders'][number],
): CustomerOrder {
  const staff = order.requestedStaffId ? store.users.find((user) => user.id === order.requestedStaffId) ?? null : null;
  const customer = store.customers.find((item) => item.id === order.customerId) ?? null;
  const approvedBy = order.approvedBy ? store.users.find((user) => user.id === order.approvedBy) ?? null : null;

  return {
    id: order.id,
    tenantId: order.tenantId,
    customerId: order.customerId,
    customerName: order.requestedName || customer?.name || 'Customer',
    customerPhone: order.requestedPhone || customer?.phoneE164 || customer?.phone || '',
    serviceId: order.serviceId,
    serviceName: order.serviceName,
    quotedPrice: order.quotedPrice,
    requestedStaffId: order.requestedStaffId ?? null,
    requestedStaffName: staff?.fullName ?? null,
    notes: order.notes,
    status: order.status,
    requestedAt: order.requestedAt,
    statusUpdatedAt: order.statusUpdatedAt ?? null,
    approvedAt: order.approvedAt ?? null,
    approvedRecordId: order.approvedRecordId ?? null,
    approvedByName: approvedBy?.fullName ?? null,
  };
}

function describeLoyaltyReward(program: LoyaltyProgram | null | undefined, currency = 'KES') {
  if (!program?.isEnabled) {
    return 'Loyalty rewards are currently turned off.';
  }

  if (program.rewardType === 'subsidized_service') {
    return program.rewardLabel?.trim() || `${formatCurrency(program.rewardValue, currency)} discount reward`;
  }

  return program.rewardLabel?.trim() || 'Complimentary service reward';
}

function buildLoyaltyProgress(program: LoyaltyProgram | null | undefined, lifetimeSpend: number, currency = 'KES') {
  const spendThreshold = Math.max(0, program?.spendThreshold ?? 0);
  const progressAmount = Math.max(0, lifetimeSpend);
  const isEnabled = Boolean(program?.isEnabled && spendThreshold > 0);
  const remainingAmount = isEnabled ? Math.max(0, spendThreshold - progressAmount) : spendThreshold;
  const progressPercent = isEnabled ? Math.min(100, Math.round((progressAmount / spendThreshold) * 100)) : 0;
  const unlocked = Boolean(isEnabled && progressAmount >= spendThreshold);

  return {
    isEnabled,
    spendThreshold,
    progressAmount,
    progressPercent,
    remainingAmount,
    unlocked,
    rewardType: program?.rewardType ?? 'free_service',
    rewardValue: program?.rewardValue ?? 0,
    rewardDescription: describeLoyaltyReward(program, currency),
    notes: program?.notes ?? null,
  };
}

const DEFAULT_PUBLIC_APP_URL = 'https://hapos.vercel.app';

export function getPublicAppBaseUrl() {
  return DEFAULT_PUBLIC_APP_URL;
}

export function buildCustomerBookingUrl(slug: string) {
  const path = `/book/${slug}`;
  const baseUrl = getPublicAppBaseUrl();

  return baseUrl ? `${baseUrl}${path}` : path;
}

export async function listTenants(): Promise<Tenant[]> {
  return listTenantsStore();
}

export async function getCurrentSubscription(tenantId: string): Promise<Subscription | null> {
  return getSubscriptionForTenant(tenantId);
}

export async function listUsers(tenantId: string | null): Promise<User[]> {
  return listUsersByTenant(tenantId);
}

export async function listServices(tenantId: string): Promise<Service[]> {
  return listServicesByTenant(tenantId);
}

export async function listProducts(tenantId: string): Promise<Product[]> {
  return listProductsByTenant(tenantId);
}

export async function listCustomers(tenantId: string): Promise<Customer[]> {
  return listCustomersByTenant(tenantId);
}

export async function listAllCustomers(tenantId: string): Promise<Customer[]> {
  return listAllCustomersByTenant(tenantId);
}

export async function listServiceRecords(tenantId: string): Promise<ServiceRecord[]> {
  return listRecordsByTenant(tenantId);
}

export async function listExpenses(tenantId: string): Promise<Expense[]> {
  return listExpensesByTenant(tenantId);
}

export async function listSubscriptions(): Promise<Subscription[]> {
  return listSubscriptionsStore();
}

export async function listSubscriptionPackages(): Promise<SubscriptionPackage[]> {
  return listSubscriptionPackagesStore();
}

export async function listSmsLogs(tenantId: string): Promise<SmsLog[]> {
  return listSmsLogsByTenant(tenantId);
}

export async function listCommissionPayouts(tenantId: string): Promise<CommissionPayout[]> {
  return listCommissionPayoutsByTenant(tenantId);
}

export async function isMarketplaceEnabledForTenant(tenantId: string) {
  const subscription = await getCurrentSubscription(tenantId);
  return subscriptionIncludesMarketplace(subscription);
}

export async function listMarketplaceFeed(tenantId: string, includeOwnPending = false): Promise<MarketplaceAd[]> {
  const store = await readStore();
  const viewerSubscription = await getCurrentSubscription(tenantId);

  if (!subscriptionIncludesMarketplace(viewerSubscription)) {
    return [];
  }

  const visibleTenantIds = new Set(
    (await listSubscriptions())
      .filter((subscription) => subscription.status === 'active' && subscriptionIncludesMarketplace(subscription))
      .map((subscription) => subscription.tenantId),
  );

  return store.marketplaceAds
    .filter((ad) => visibleTenantIds.has(ad.tenantId))
    .filter((ad) => ad.status === 'approved' || (includeOwnPending && ad.tenantId === tenantId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((ad) => mapMarketplaceAd(store, ad, tenantId));
}

export async function listMarketplaceQueue(): Promise<MarketplaceAd[]> {
  const store = await readStore();

  return store.marketplaceAds
    .slice()
    .sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === 'pending') return -1;
        if (b.status === 'pending') return 1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    })
    .map((ad) => mapMarketplaceAd(store, ad));
}

export async function listCustomerOrders(
  tenantId: string,
  options: { status?: CustomerOrder['status'] | CustomerOrder['status'][] } = {},
): Promise<CustomerOrder[]> {
  const store = await readStore();
  const statuses = options.status ? new Set(Array.isArray(options.status) ? options.status : [options.status]) : null;

  return store.customerOrders
    .filter((order) => order.tenantId === tenantId)
    .filter((order) => !statuses || statuses.has(order.status))
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .map((order) => mapCustomerOrder(store, order));
}

export async function listCustomerOrdersForCustomer(tenantId: string, customerId: string): Promise<CustomerOrder[]> {
  const store = await readStore();

  return store.customerOrders
    .filter((order) => order.tenantId === tenantId && order.customerId === customerId)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .map((order) => mapCustomerOrder(store, order));
}

export async function getTenantBookingContext(businessSlug: string) {
  const tenant = (await listTenants()).find((item) => item.slug.toLowerCase() === businessSlug.trim().toLowerCase()) ?? null;

  if (!tenant) {
    return {
      tenant: null,
      subscription: null,
      services: [],
      staff: [],
      accessState: { blocked: true as const, reason: 'missing_tenant' as const, message: 'Business not found.' },
      bookingUrl: null,
    };
  }

  const [subscription, services, users] = await Promise.all([
    getCurrentSubscription(tenant.id),
    listServices(tenant.id),
    listUsers(tenant.id),
  ]);

  return {
    tenant,
    subscription,
    services: services.filter((service) => service.isActive),
    staff: users
      .filter((user) => user.isActive && (user.role === 'staff' || user.role === 'shop_admin'))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)),
    accessState: getAccessState({
      tenantStatus: tenant.status,
      suspensionReason: tenant.suspensionReason,
      subscriptionStatus: subscription?.status,
      endsAt: subscription?.endsAt,
      graceEndsAt: subscription?.graceEndsAt,
    }),
    bookingUrl: buildCustomerBookingUrl(tenant.slug),
  };
}

export function calculateCommission(input: {
  service?: Pick<Service, 'commissionType' | 'commissionValue'> | null;
  staff?: Pick<User, 'commissionType' | 'commissionValue'> | null;
  price: number;
}): { commissionType: CommissionType; commissionValue: number; commissionAmount: number } {
  const commissionType = input.staff?.commissionType ?? input.service?.commissionType ?? 'percentage';
  const commissionValue = input.staff?.commissionValue ?? input.service?.commissionValue ?? 0;
  const commissionAmount =
    commissionType === 'fixed' ? commissionValue : Math.round((input.price * commissionValue) / 100);

  return {
    commissionType,
    commissionValue,
    commissionAmount,
  };
}

export async function getStaffMetrics(tenantId: string, staffId: string): Promise<StaffMetrics> {
  const now = new Date();
  const records = (await listServiceRecords(tenantId)).filter((record) => record.staffId === staffId);
  const todayRecords = records.filter((record) => sameUtcDay(record.performedAt, now));
  const monthRecords = records.filter((record) => sameUtcMonth(record.performedAt, now));

  return {
    todayClients: new Set(todayRecords.map((record) => record.customerId)).size,
    monthClients: new Set(monthRecords.map((record) => record.customerId)).size,
    todaySales: todayRecords.reduce((sum, record) => sum + record.price, 0),
    monthSales: monthRecords.reduce((sum, record) => sum + record.price, 0),
    todayCommission: todayRecords.reduce((sum, record) => sum + record.commission, 0),
    monthCommission: monthRecords.reduce((sum, record) => sum + record.commission, 0),
  };
}

export async function getStaffPerformance(tenantId: string, month = new Date()): Promise<StaffPerformance[]> {
  const [users, records] = await Promise.all([listUsers(tenantId), listServiceRecords(tenantId)]);
  const monthRecords = records.filter((record) => sameUtcMonth(record.performedAt, month));

  return buildStaffPerformance(users, monthRecords);
}

export async function getFinancialRows(tenantId: string): Promise<FinancialRow[]> {
  const [records, expenses, payouts] = await Promise.all([
    listServiceRecords(tenantId),
    listExpenses(tenantId),
    listCommissionPayouts(tenantId),
  ]);

  const periods = new Set<string>();
  for (const record of records) periods.add(record.performedAt.slice(0, 10));
  for (const expense of expenses) periods.add(expense.expenseDate);
  for (const payout of payouts) if (payout.paidAt) periods.add(payout.paidAt.slice(0, 10));

  return Array.from(periods)
    .sort((a, b) => b.localeCompare(a))
    .map((period) => {
      const periodRecords = records.filter((record) => record.performedAt.startsWith(period));
      const periodExpenses = expenses.filter((expense) => expense.expenseDate === period);
      const periodPayouts = payouts.filter((payout) => payout.paidAt?.startsWith(period));
      const productCosts = periodRecords.reduce((sum, record) => sum + getProductCost(record), 0);
      const income = periodRecords.reduce((sum, record) => sum + record.price, 0);
      const expenseTotal = periodExpenses.reduce((sum, expense) => sum + expense.amount, 0);
      const commissionsPaid = periodPayouts.reduce((sum, payout) => sum + payout.amount, 0);

      return {
        period,
        income,
        expenses: expenseTotal,
        commissionsPaid,
        productCosts,
        netProfit: income - expenseTotal - commissionsPaid - productCosts,
      };
    });
}

export async function getDashboardSummary(session: AppSession): Promise<DashboardSummary> {
  if (!session.tenant) {
    return {
      todayRevenue: 0,
      monthRevenue: 0,
      monthExpenses: 0,
      monthCommissionAccrued: 0,
      monthCommissionPaid: 0,
      monthProductCosts: 0,
      monthNetProfit: 0,
      currentMonthLabel: startOfMonthLabel(new Date()),
      previousMonthLabel: startOfMonthLabel(addUtcMonths(new Date(), -1)),
      previousMonthRevenue: 0,
      previousMonthCommissionAccrued: 0,
      lifetimeRevenue: 0,
      lifetimeCommission: 0,
      highestEarner: null,
      monthlyTrend: [],
      topStaff: [],
      recentServices: [],
    };
  }

  const now = new Date();
  const previousMonth = addUtcMonths(now, -1);
  const tenantId = session.tenant.id;
  const [records, expenses, payouts, staffPerformance] = await Promise.all([
    listServiceRecords(tenantId),
    listExpenses(tenantId),
    listCommissionPayouts(tenantId),
    getStaffPerformance(tenantId, now),
  ]);

  const visibleRecords =
    session.user.role === 'staff' ? records.filter((record) => record.staffId === session.user.id) : records;

  const todayRevenue = visibleRecords
    .filter((record) => sameUtcDay(record.performedAt, now))
    .reduce((sum, record) => sum + record.price, 0);
  const monthRevenue = visibleRecords
    .filter((record) => sameUtcMonth(record.performedAt, now))
    .reduce((sum, record) => sum + record.price, 0);
  const monthCommissionAccrued = visibleRecords
    .filter((record) => sameUtcMonth(record.performedAt, now))
    .reduce((sum, record) => sum + record.commission, 0);
  const previousMonthRevenue = visibleRecords
    .filter((record) => sameUtcMonth(record.performedAt, previousMonth))
    .reduce((sum, record) => sum + record.price, 0);
  const previousMonthCommissionAccrued = visibleRecords
    .filter((record) => sameUtcMonth(record.performedAt, previousMonth))
    .reduce((sum, record) => sum + record.commission, 0);
  const monthProductCosts = visibleRecords
    .filter((record) => sameUtcMonth(record.performedAt, now))
    .reduce((sum, record) => sum + getProductCost(record), 0);
  const monthExpenses =
    session.user.role === 'staff'
      ? 0
      : expenses
          .filter((expense) => sameUtcMonth(`${expense.expenseDate}T00:00:00.000Z`, now))
          .reduce((sum, expense) => sum + expense.amount, 0);
  const monthCommissionPaid =
    session.user.role === 'staff'
      ? 0
      : payouts
          .filter((payout) => payout.paidAt && sameUtcMonth(payout.paidAt, now))
          .reduce((sum, payout) => sum + payout.amount, 0);
  const monthlyTrend = buildMonthlyContribution(visibleRecords, now);

  return {
    todayRevenue,
    monthRevenue,
    monthExpenses,
    monthCommissionAccrued,
    monthCommissionPaid,
    monthProductCosts,
    monthNetProfit: monthRevenue - monthExpenses - monthCommissionPaid - monthProductCosts,
    currentMonthLabel: startOfMonthLabel(now),
    previousMonthLabel: startOfMonthLabel(previousMonth),
    previousMonthRevenue,
    previousMonthCommissionAccrued,
    lifetimeRevenue: visibleRecords.reduce((sum, record) => sum + record.price, 0),
    lifetimeCommission: visibleRecords.reduce((sum, record) => sum + record.commission, 0),
    highestEarner: session.user.role === 'staff' ? null : staffPerformance[0] ?? null,
    monthlyTrend,
    topStaff: session.user.role === 'staff' ? staffPerformance.filter((row) => row.staffId === session.user.id) : staffPerformance,
    recentServices: visibleRecords.slice(0, 10),
  };
}

export async function getCustomerPortalSummary(tenantId: string, customerId: string) {
  const [store, customers, records, services] = await Promise.all([
    readStore(),
    listAllCustomers(tenantId),
    listServiceRecords(tenantId),
    listServices(tenantId),
  ]);

  const customer = customers.find((item) => item.id === customerId) ?? null;
  const customerRecords = records.filter((record) => record.customerId === customerId);
  const customerOrders = store.customerOrders
    .filter((order) => order.tenantId === tenantId && order.customerId === customerId)
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .map((order) => mapCustomerOrder(store, order));
  const currentMonth = new Date();
  const monthRecords = customerRecords.filter((record) => sameUtcMonth(record.performedAt, currentMonth));
  const lifetimeValue = customer?.lifetimeValue ?? customerRecords.reduce((sum, record) => sum + record.price, 0);
  const totalVisits = customer?.totalVisits ?? customerRecords.length;
  const tenant = store.tenants.find((item) => item.id === tenantId) ?? null;
  const loyalty = buildLoyaltyProgress(tenant?.loyaltyProgram ?? null, lifetimeValue, tenant?.currencyCode ?? 'KES');

  return {
    customer,
    records: customerRecords,
    orders: customerOrders,
    services,
    loyalty,
    summary: {
      totalVisits,
      lifetimeValue,
      thisMonthVisits: monthRecords.length,
      thisMonthSpend: monthRecords.reduce((sum, record) => sum + record.price, 0),
      lastVisitAt: customer?.lastVisitAt ?? customerRecords[0]?.performedAt ?? null,
    },
  };
}

export async function listCustomerLoyaltyProgress(tenantId: string) {
  const [tenants, customers] = await Promise.all([listTenants(), listCustomers(tenantId)]);
  const tenant = tenants.find((item) => item.id === tenantId) ?? null;

  return customers
    .map((customer) => {
      const loyalty = buildLoyaltyProgress(
        tenant?.loyaltyProgram ?? null,
        customer.lifetimeValue ?? 0,
        tenant?.currencyCode ?? 'KES',
      );

      return {
        customer,
        totalVisits: customer.totalVisits ?? 0,
        lifetimeValue: customer.lifetimeValue ?? 0,
        progressPercent: loyalty.progressPercent,
        remainingAmount: loyalty.remainingAmount,
        unlocked: loyalty.unlocked,
      };
    })
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue);
}

export async function getMonthlyReport(tenantId: string, month = new Date()): Promise<MonthlyReport> {
  const [customers, records, expenses, users] = await Promise.all([
    listCustomers(tenantId),
    listServiceRecords(tenantId),
    listExpenses(tenantId),
    listUsers(tenantId),
  ]);

  const monthRecords = records.filter((record) => sameUtcMonth(record.performedAt, month));
  const monthExpenses = expenses.filter((expense) => sameUtcMonth(`${expense.expenseDate}T00:00:00.000Z`, month));
  const performance = buildStaffPerformance(users, monthRecords);

  const rankedCustomers = customers
    .map((customer) => {
      const customerRecords = monthRecords.filter((record) => record.customerId === customer.id);
      return {
        customer,
        visits: customerRecords.length,
        spent: customerRecords.reduce((sum, record) => sum + record.price, 0),
      };
    })
    .sort((a, b) => b.visits - a.visits || b.spent - a.spent);
  const topCustomerByVisits = rankedCustomers[0] ?? null;
  const topCustomerBySpend = [...rankedCustomers].sort((a, b) => b.spent - a.spent)[0] ?? null;

  const productMap = new Map<string, { productName: string; usageCount: number; totalCost: number }>();
  for (const record of monthRecords) {
    for (const usage of record.productUsages ?? []) {
      const current = productMap.get(usage.productId) ?? {
        productName: usage.productName,
        usageCount: 0,
        totalCost: 0,
      };
      current.usageCount += usage.quantity;
      current.totalCost += usage.totalCost;
      productMap.set(usage.productId, current);
    }
  }

  const totalRevenue = monthRecords.reduce((sum, record) => sum + record.price, 0);
  const totalCommissions = monthRecords.reduce((sum, record) => sum + record.commission, 0);
  const totalExpenses = monthExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const totalProductCosts = monthRecords.reduce((sum, record) => sum + getProductCost(record), 0);

  const improvements: string[] = [];
  const headaches: string[] = [];
  const remarks: string[] = [];

  if (monthRecords.some((record) => record.isCustomService)) {
    remarks.push('Custom off-price-list services are being recorded, so consider reviewing whether they should be formalized into the main price list.');
  }

  if (totalExpenses > totalRevenue * 0.4) {
    headaches.push('Expenses are consuming more than 40% of revenue this month.');
    improvements.push('Audit high-cost categories and product waste to improve margin.');
  }

  if ((topCustomerByVisits?.visits ?? 0) < 3) {
    improvements.push(
      'Customer loyalty is shallow this month, so follow-up offers or visit reminders may help repeat traffic.',
    );
  }

  if (productMap.size === 0) {
    headaches.push('No product usage has been recorded, which makes product-cost reporting incomplete.');
  }

  if (performance.length > 1 && performance[0].totalRevenue > performance[performance.length - 1].totalRevenue * 2) {
    remarks.push('Performance variance across staff is high, which may signal coaching or schedule-balancing opportunities.');
  }

  if (headaches.length === 0) {
    headaches.push('No major operational headache stands out from the available data this month.');
  }

  if (improvements.length === 0) {
    improvements.push('Keep recording product usage and custom services consistently so next month\'s report becomes more precise.');
  }

  return {
    monthLabel: startOfMonthLabel(month),
    topCustomerByVisits: topCustomerByVisits
      ? {
          customer: topCustomerByVisits.customer,
          visits: topCustomerByVisits.visits,
          spent: topCustomerByVisits.spent,
        }
      : null,
    topCustomerBySpend: topCustomerBySpend
      ? {
          customer: topCustomerBySpend.customer,
          visits: topCustomerBySpend.visits,
          spent: topCustomerBySpend.spent,
        }
      : null,
    staffRanking: performance,
    totalExpenses,
    totalRevenue,
    totalCommissions,
    totalProductCosts,
    topProducts: Array.from(productMap.values()).sort((a, b) => b.usageCount - a.usageCount).slice(0, 5),
    remarks,
    headaches,
    improvements,
  };
}
