import { listCustomers, listServiceRecords, listSubscriptions, listTenants, listUsers } from '@/server/services/app-data';
import { getSubscriptionDisplayName } from '@/lib/plans';
import { readStore } from '@/server/store';
import { isActiveServiceRecord } from '@/server/store/service-records';

function sameUtcMonth(iso: string, now: Date) {
  const date = new Date(iso);
  return date.getUTCFullYear() === now.getUTCFullYear() && date.getUTCMonth() === now.getUTCMonth();
}

function toSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export async function listCredentialRecordsForTenant(tenantId: string) {
  const store = await readStore();

  return store.users
    .filter((user) => user.tenantId === tenantId)
    .map((user) => ({
      userId: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      passwordUpdatedAt: user.passwordUpdatedAt ?? null,
      commissionType: user.commissionType ?? 'percentage',
      commissionValue: user.commissionValue ?? 0,
      commissionNotes: user.commissionNotes ?? '',
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getPlatformOverview() {
  const now = new Date();
  const [tenants, subscriptions] = await Promise.all([listTenants(), listSubscriptions()]);

  const tenantRows = await Promise.all(
    tenants.map(async (tenant) => {
      const [customers, records, users] = await Promise.all([
        listCustomers(tenant.id),
        listServiceRecords(tenant.id),
        listUsers(tenant.id),
      ]);

      const monthRecords = records.filter((record) => sameUtcMonth(record.performedAt, now));
      const allTimeRevenue = records.reduce((sum, record) => sum + record.price, 0);
      const monthRevenue = monthRecords.reduce((sum, record) => sum + record.price, 0);
      const productUsage = new Map<string, { quantity: number; totalCost: number }>();

      for (const record of records) {
        for (const usage of record.productUsages ?? []) {
          const current = productUsage.get(usage.productName) ?? { quantity: 0, totalCost: 0 };
          current.quantity += usage.quantity;
          current.totalCost += usage.totalCost;
          productUsage.set(usage.productName, current);
        }
      }

      const topProducts = Array.from(productUsage.entries())
        .sort((a, b) => b[1].quantity - a[1].quantity)
        .slice(0, 3)
        .map(([productName, data]) => ({
          productName,
          quantity: data.quantity,
          totalCost: data.totalCost,
        }));

      return {
        tenantId: tenant.id,
        tenantName: tenant.name,
        ownerName: tenant.ownerName ?? 'Not set',
        slug: tenant.slug,
        logoUrl: tenant.logoUrl ?? null,
        motto: tenant.motto ?? null,
        address: tenant.address ?? null,
        storeNumber: tenant.storeNumber ?? null,
        status: tenant.status,
        planCode: subscriptions.find((item) => item.tenantId === tenant.id)?.planCode ?? 'basic',
        packageName: subscriptions.find((item) => item.tenantId === tenant.id)?.packageName ?? 'Basic',
        subscriptionStatus: subscriptions.find((item) => item.tenantId === tenant.id)?.status ?? 'missing',
        licenceEndsAt: subscriptions.find((item) => item.tenantId === tenant.id)?.endsAt ?? null,
        customerCount: customers.length,
        employeeCount: users.length,
        monthRevenue,
        allTimeRevenue,
        topProducts,
      };
    }),
  );

  return {
    tenantCount: tenantRows.length,
    activeTenantCount: tenantRows.filter((row) => row.status === 'active').length,
    totalCustomers: tenantRows.reduce((sum, row) => sum + row.customerCount, 0),
    monthRevenue: tenantRows.reduce((sum, row) => sum + row.monthRevenue, 0),
    allTimeRevenue: tenantRows.reduce((sum, row) => sum + row.allTimeRevenue, 0),
    tenantRows: tenantRows.sort((a, b) => b.monthRevenue - a.monthRevenue),
  };
}

export async function buildTenantExportDocument(tenantId: string) {
  const store = await readStore();
  const tenant = store.tenants.find((item) => item.id === tenantId);

  if (!tenant) {
    return null;
  }

  const users = store.users
    .filter((item) => item.tenantId === tenantId)
    .map(({ password, ...user }) => user);
  const customers = store.customers.filter((item) => item.tenantId === tenantId);
  const services = store.services.filter((item) => item.tenantId === tenantId);
  const products = store.products.filter((item) => item.tenantId === tenantId);
  const marketplaceAds = store.marketplaceAds.filter((item) => item.tenantId === tenantId);
  const customerOrders = store.customerOrders
    .filter((item) => item.tenantId === tenantId)
    .map((order) => ({
      ...order,
      customerName: store.customers.find((item) => item.id === order.customerId)?.name ?? order.requestedName,
      requestedStaffName: order.requestedStaffId
        ? store.users.find((item) => item.id === order.requestedStaffId)?.fullName ?? null
        : null,
    }));
  const serviceRecords = store.serviceRecords
    .filter((item) => item.tenantId === tenantId)
    .map((record) => ({
      ...record,
      customerName: store.customers.find((item) => item.id === record.customerId)?.name ?? null,
      staffName: store.users.find((item) => item.id === record.staffId)?.fullName ?? null,
      correctedByName: record.correctedBy ? store.users.find((item) => item.id === record.correctedBy)?.fullName ?? null : null,
      voidedByName: record.voidedBy ? store.users.find((item) => item.id === record.voidedBy)?.fullName ?? null : null,
    }));
  const activeServiceRecords = serviceRecords.filter(isActiveServiceRecord);
  const expenses = store.expenses.filter((item) => item.tenantId === tenantId);
  const smsLogs = store.smsLogs.filter((item) => item.tenantId === tenantId);
  const commissionPayouts = store.commissionPayouts.filter((item) => item.tenantId === tenantId);
  const subscription = store.subscriptions.find((item) => item.tenantId === tenantId) ?? null;

  const totalRevenue = activeServiceRecords.reduce((sum, record) => sum + record.price, 0);
  const totalExpenses = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const totalCommissions = activeServiceRecords.reduce((sum, record) => sum + record.commissionAmount, 0);
  const totalProductCosts = activeServiceRecords.reduce(
    (sum, record) => sum + record.productUsages.reduce((usageSum, usage) => usageSum + usage.quantity * usage.unitCost, 0),
    0,
  );

  return {
    exportedAt: new Date().toISOString(),
    tenant,
    subscription,
    summary: {
      totalRevenue,
      totalExpenses,
      totalCommissions,
      totalProductCosts,
      serviceRecordCount: activeServiceRecords.length,
      customerCount: customers.length,
      archivedCustomerCount: customers.filter((customer) => customer.archivedAt).length,
      marketplaceAdCount: marketplaceAds.length,
      customerOrderCount: customerOrders.length,
    },
    users,
    customers,
    customerOrders,
    services,
    products,
    marketplaceAds,
    serviceRecords,
    expenses,
    smsLogs,
    commissionPayouts,
  };
}

export async function buildPlatformExportDocument() {
  const overview = await getPlatformOverview();

  return {
    exportedAt: new Date().toISOString(),
    summary: {
      tenantCount: overview.tenantCount,
      activeTenantCount: overview.activeTenantCount,
      totalCustomers: overview.totalCustomers,
      monthRevenue: overview.monthRevenue,
      allTimeRevenue: overview.allTimeRevenue,
    },
    tenants: overview.tenantRows,
  };
}

export async function buildTenantExportCsv(tenantId: string) {
  const store = await readStore();
  const tenant = store.tenants.find((item) => item.id === tenantId);

  if (!tenant) {
    return null;
  }

  const rows = [
    'type,date,customer,staff,service_or_category,amount,commission,product_cost,notes,corrected_at,corrected_by,voided_at,voided_by,void_reason',
    ...store.serviceRecords
      .filter((item) => item.tenantId === tenantId)
      .map((record) => {
        const customerName = store.customers.find((item) => item.id === record.customerId)?.name ?? '';
        const staffName = store.users.find((item) => item.id === record.staffId)?.fullName ?? '';
        const productCost = record.productUsages.reduce((sum, usage) => sum + usage.quantity * usage.unitCost, 0);
        const correctedByName = record.correctedBy ? store.users.find((item) => item.id === record.correctedBy)?.fullName ?? '' : '';
        const voidedByName = record.voidedBy ? store.users.find((item) => item.id === record.voidedBy)?.fullName ?? '' : '';
        return [
          'service',
          record.performedAt,
          customerName,
          staffName,
          record.serviceName,
          record.price,
          record.commissionAmount,
          productCost,
          (record.description ?? '').replace(/,/g, ';'),
          record.correctedAt ?? '',
          correctedByName,
          record.voidedAt ?? '',
          voidedByName,
          (record.voidReason ?? '').replace(/,/g, ';'),
        ].join(',');
      }),
    ...store.expenses
      .filter((item) => item.tenantId === tenantId)
      .map((expense) =>
        [
          'expense',
          expense.expenseDate,
          '',
          '',
          expense.category,
          expense.amount,
          '',
          '',
          (expense.description ?? '').replace(/,/g, ';'),
          '',
          '',
        ].join(','),
      ),
    ...store.commissionPayouts
      .filter((item) => item.tenantId === tenantId)
      .map((payout) => {
        const staffName = store.users.find((item) => item.id === payout.staffId)?.fullName ?? '';
        return [
          'commission_payout',
          payout.paidAt ?? `${payout.periodEnd}T00:00:00.000Z`,
          '',
          staffName,
          `${payout.periodStart} to ${payout.periodEnd}`,
          payout.amount,
          payout.amount,
          '',
          '',
          '',
          '',
        ].join(',');
      }),
  ].join('\n');

  return {
    filename: `${toSlug(tenant.name)}-archive-${new Date().toISOString().slice(0, 10)}.csv`,
    content: rows,
  };
}

export async function buildPlatformExportCsv() {
  const overview = await getPlatformOverview();

  const rows = [
    'shop,owner,package,motto,address,store_number,status,subscription_status,licence_ends,customer_count,employee_count,month_revenue,all_time_revenue,top_products',
    ...overview.tenantRows.map((row) =>
      [
        row.tenantName,
        row.ownerName,
        row.packageName || getSubscriptionDisplayName({ packageName: row.packageName, planCode: row.planCode }),
        (row.motto ?? '').replace(/,/g, ';'),
        (row.address ?? '').replace(/,/g, ';'),
        row.storeNumber ?? '',
        row.status,
        row.subscriptionStatus,
        row.licenceEndsAt ?? '',
        row.customerCount,
        row.employeeCount,
        row.monthRevenue,
        row.allTimeRevenue,
        row.topProducts.map((item) => `${item.productName} (${item.quantity})`).join(' | ').replace(/,/g, ';'),
      ].join(','),
    ),
  ].join('\n');

  return {
    filename: `hapos-platform-overview-${new Date().toISOString().slice(0, 10)}.csv`,
    content: rows,
  };
}
