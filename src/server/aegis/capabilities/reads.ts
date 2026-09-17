/**
 * AEGIS read capabilities. Every handler calls the same canonical services
 * and views the UI itself consumes (app-data, order-service, store readers,
 * repository views) — no duplicated business logic, no direct persistence
 * access beyond those services. Tenant scope comes from the validated
 * capability context only; staff principals additionally see only their own
 * rows where the UI does the same (seller portal pattern).
 */

import {
  getCatalog,
  getCurrentSubscription,
  getCustomerPortalSummary,
  getFinancialRows,
  getMonthlyReport,
  getStaffMetrics,
  getStaffPerformance,
  listAllCustomers,
  listCommissionPayouts,
  listCustomerOrders,
  listCustomers,
  listExpenses,
  listInventoryMovements,
  listMarketplaceFeed,
  listServices,
  listUsers,
} from '@/server/services/app-data';
import {
  getCommerceOrder,
  getCommerceSale,
  getOrderPayments,
  listCommerceOrders,
  listCommerceSales,
} from '@/server/commerce/order-service';
import { getCommerceRepository } from '@/server/commerce/repository-select';
import { maskCustomerPhone } from '@/server/commerce/payments';
import { getMpesaAvailability } from '@/server/payments/payment-service';
import {
  getTenantById,
  listAttendanceRecordsByTenant,
  listAttendanceTerminalsByTenant,
  listSellerCredentialsByTenant,
  listTenantsStore,
} from '@/server/store';
import { AiError } from '@/server/aegis/errors';
import { inRange, paginate, str, type CapabilityContext, type CapabilityDef } from '@/server/aegis/registry';

type CommerceSession = { tenantId: string; userId: string; userRole: 'shop_admin' | 'staff' | 'super_admin' };

function sessionOf(ctx: CapabilityContext): CommerceSession {
  const role = ctx.role === 'master' || ctx.role === 'super_admin' ? 'super_admin' : ctx.role === 'staff' ? 'staff' : 'shop_admin';
  return { tenantId: ctx.tenantId, userId: ctx.userId, userRole: role };
}

function ownOnly(ctx: CapabilityContext): boolean {
  return ctx.role === 'staff';
}

const PAGED = {
  limit: { type: 'number' as const, description: 'Max rows (default 20, cap 100).' },
  offset: { type: 'number' as const, description: 'Rows to skip (default 0).' },
};

const DATED = {
  from: { type: 'string' as const, description: 'Optional ISO start bound.' },
  to: { type: 'string' as const, description: 'Optional ISO end bound.' },
};

const ALL_ROLES = ['shop_admin', 'staff', 'super_admin'];
const ADMIN_ROLES = ['shop_admin', 'super_admin'];

function notFound(what: string): AiError {
  return new AiError('NOT_FOUND', `${what} was not found for this shop.`, false);
}

export const READ_CAPABILITIES: CapabilityDef[] = [
  {
    id: 'shop.get',
    domain: 'Shop',
    description: 'Current shop identity, policy and subscription state.',
    type: 'read',
    risk: 'low',
    params: {},
    roles: ALL_ROLES,
    handler: async (ctx) => {
      const tenant = await getTenantById(ctx.tenantId);
      if (!tenant) {
        throw notFound('Shop');
      }
      const [policy, subscription] = await Promise.all([
        getCommerceRepository().getTenantPolicy(ctx.tenantId),
        getCurrentSubscription(ctx.tenantId),
      ]);
      return {
        shopId: tenant.id,
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        currencyCode: tenant.currencyCode,
        timezone: tenant.timezone,
        orderReviewRequired: policy.orderReviewRequired,
        planCode: subscription?.planCode ?? null,
        subscriptionStatus: subscription?.status ?? null,
      };
    },
  },
  {
    id: 'products.list',
    domain: 'Products',
    description: 'Sellable catalog products with stock status. Supports text search.',
    type: 'read',
    risk: 'low',
    params: { q: { type: 'string', description: 'Optional case-insensitive name/SKU filter.' }, ...PAGED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const items = await getCatalog(ctx.tenantId);
      const q = str(args.q)?.toLowerCase() ?? null;
      const products = items.filter((item) => item.type === 'product' && (!q || item.name.toLowerCase().includes(q)));
      return paginate(products, args);
    },
  },
  {
    id: 'products.get',
    domain: 'Products',
    description: 'One catalog product with stock status.',
    type: 'read',
    risk: 'low',
    params: { productId: { type: 'string', description: 'Product id.', required: true } },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const items = await getCatalog(ctx.tenantId);
      const found = items.find((item) => item.type === 'product' && item.id === args.productId) ?? null;
      if (!found) {
        throw notFound('Product');
      }
      return found;
    },
  },
  {
    id: 'services.list',
    domain: 'Services',
    description: 'Sellable services. Supports text search.',
    type: 'read',
    risk: 'low',
    params: { q: { type: 'string', description: 'Optional case-insensitive name filter.' }, ...PAGED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const items = await getCatalog(ctx.tenantId);
      const q = str(args.q)?.toLowerCase() ?? null;
      const services = items.filter((item) => item.type === 'service' && (!q || item.name.toLowerCase().includes(q)));
      return paginate(services, args);
    },
  },
  {
    id: 'services.get',
    domain: 'Services',
    description: 'One service with pricing and commission terms.',
    type: 'read',
    risk: 'low',
    params: { serviceId: { type: 'string', description: 'Service id.', required: true } },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const services = await listServices(ctx.tenantId);
      const found = services.find((item) => item.id === args.serviceId) ?? null;
      if (!found) {
        throw notFound('Service');
      }
      return found;
    },
  },
  {
    id: 'customers.list',
    domain: 'Customers',
    description: 'Shop customers (active marketing list).',
    type: 'read',
    risk: 'low',
    params: { ...PAGED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => paginate(await listCustomers(ctx.tenantId), args),
  },
  {
    id: 'customers.search',
    domain: 'Customers',
    description: 'Search all shop customers by name or phone.',
    type: 'read',
    risk: 'low',
    params: { q: { type: 'string', description: 'Name or phone fragment.', required: true }, ...PAGED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const q = str(args.q);
      if (!q) {
        throw new AiError('INVALID_ARGUMENT', 'Search text is required.', false);
      }
      const needle = q.toLowerCase();
      const matches = (await listAllCustomers(ctx.tenantId)).filter(
        (customer) => customer.name.toLowerCase().includes(needle) || customer.phone.includes(q) || (customer.phoneE164 ?? '').includes(q),
      );
      return paginate(matches, args);
    },
  },
  {
    id: 'customers.get',
    domain: 'Customers',
    description: 'One customer with loyalty progress.',
    type: 'read',
    risk: 'low',
    params: { customerId: { type: 'string', description: 'Customer id.', required: true } },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const found = (await listAllCustomers(ctx.tenantId)).find((item) => item.id === args.customerId) ?? null;
      if (!found) {
        throw notFound('Customer');
      }
      return found;
    },
  },
  {
    id: 'customers.history',
    domain: 'Customers',
    description: 'Customer portal summary: records, orders, loyalty, totals.',
    type: 'read',
    risk: 'low',
    params: { customerId: { type: 'string', description: 'Customer id.', required: true } },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => {
      const found = (await listAllCustomers(ctx.tenantId)).find((item) => item.id === args.customerId) ?? null;
      if (!found) {
        throw notFound('Customer');
      }
      return getCustomerPortalSummary(ctx.tenantId, found.id);
    },
  },
  {
    id: 'staff.list',
    domain: 'Staff',
    description: 'Shop users (staff and admins). Staff principals see only themselves.',
    type: 'read',
    risk: 'low',
    params: { ...PAGED },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => paginate(await listUsers(ctx.tenantId), args),
  },
  {
    id: 'staff.get',
    domain: 'Staff',
    description: 'One staff member with metrics.',
    type: 'read',
    risk: 'low',
    params: { staffId: { type: 'string', description: 'User id.', required: true } },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => {
      const found = (await listUsers(ctx.tenantId)).find((item) => item.id === args.staffId) ?? null;
      if (!found) {
        throw notFound('Staff member');
      }
      return found;
    },
  },
  {
    id: 'staff.performance',
    domain: 'Staff',
    description: 'Staff performance and metrics. Staff principals see only themselves.',
    type: 'read',
    risk: 'low',
    params: {
      staffId: { type: 'string', description: 'User id (defaults to caller).' },
      month: { type: 'string', description: 'Optional YYYY-MM month.' },
    },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const staffId = ownOnly(ctx) ? ctx.userId : ((str(args.staffId) ?? ctx.userId) as string);
      const month = typeof args.month === 'string' && /^\d{4}-\d{2}$/.test(args.month) ? new Date(`${args.month}-01T00:00:00.000Z`) : new Date();
      const [performance, metrics] = await Promise.all([
        getStaffPerformance(ctx.tenantId, month),
        getStaffMetrics(ctx.tenantId, staffId),
      ]);
      const row = performance.find((item) => item.staffId === staffId) ?? null;
      return { staffId, metrics, ranking: row };
    },
  },
  {
    id: 'bookings.list',
    domain: 'Bookings',
    description: 'Customer booking requests. Staff principals see only their own.',
    type: 'read',
    risk: 'low',
    params: { status: { type: 'string', description: 'Optional status filter.' }, ...PAGED, ...DATED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const status = str(args.status);
      const orders = await listCustomerOrders(ctx.tenantId, status ? { status: status as never } : {});
      const scoped = ownOnly(ctx) ? orders.filter((order) => order.requestedStaffId === ctx.userId) : orders;
      const ranged = scoped.filter((order) => inRange(order.requestedAt, args.from, args.to));
      return paginate(ranged, args);
    },
  },
  {
    id: 'bookings.get',
    domain: 'Bookings',
    description: 'One booking request.',
    type: 'read',
    risk: 'low',
    params: { bookingId: { type: 'string', description: 'Booking id.', required: true } },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const found = (await listCustomerOrders(ctx.tenantId)).find((item) => item.id === args.bookingId) ?? null;
      if (!found || (ownOnly(ctx) && found.requestedStaffId !== ctx.userId)) {
        throw notFound('Booking');
      }
      return found;
    },
  },
  {
    id: 'orders.list',
    domain: 'Orders',
    description: 'Commerce orders. Staff principals see only their own.',
    type: 'read',
    risk: 'low',
    params: { ...PAGED, ...DATED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const orders = await listCommerceOrders(sessionOf(ctx), { ownOnly: ownOnly(ctx) });
      const ranged = orders.filter((order) => inRange(order.createdAt, args.from, args.to));
      return paginate(ranged, args);
    },
  },
  {
    id: 'orders.get',
    domain: 'Orders',
    description: 'One order with lines. Staff principals see only their own.',
    type: 'read',
    risk: 'low',
    params: { orderId: { type: 'string', description: 'Order id.', required: true } },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const order = await getCommerceOrder(sessionOf(ctx), String(args.orderId));
      if (!order || (ownOnly(ctx) && order.sellerId !== ctx.userId)) {
        throw notFound('Order');
      }
      const payments = await getOrderPayments(sessionOf(ctx), order.id);
      return { ...order, payments };
    },
  },
  {
    id: 'orders.pending',
    domain: 'Orders',
    description: 'Orders awaiting review (pending queue).',
    type: 'read',
    risk: 'low',
    params: { ...PAGED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const orders = await listCommerceOrders(sessionOf(ctx), { ownOnly: ownOnly(ctx) });
      const pending = orders.filter((order) => order.status === 'PENDING_REVIEW' || order.status === 'SUBMITTED');
      return paginate(pending, args);
    },
  },
  {
    id: 'sales.list',
    domain: 'Sales',
    description: 'Completed sales. Staff principals see only their own.',
    type: 'read',
    risk: 'low',
    params: { ...PAGED, ...DATED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const sales = await listCommerceSales(sessionOf(ctx), { ownOnly: ownOnly(ctx) });
      const ranged = sales.filter((sale) => inRange(sale.createdAt, args.from, args.to));
      return paginate(ranged, args);
    },
  },
  {
    id: 'sales.get',
    domain: 'Sales',
    description: 'One completed sale with lines.',
    type: 'read',
    risk: 'low',
    params: { saleId: { type: 'string', description: 'Sale id.', required: true } },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const sale = await getCommerceSale(sessionOf(ctx), String(args.saleId));
      if (!sale || (ownOnly(ctx) && sale.sellerId !== ctx.userId)) {
        throw notFound('Sale');
      }
      return sale;
    },
  },
  {
    id: 'inventory.stock',
    domain: 'Inventory',
    description: 'Current stock per product with status.',
    type: 'read',
    risk: 'low',
    params: { q: { type: 'string', description: 'Optional name/SKU filter.' }, ...PAGED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const items = await getCatalog(ctx.tenantId);
      const q = str(args.q)?.toLowerCase() ?? null;
      const products = items
        .filter((item) => item.type === 'product' && (!q || item.name.toLowerCase().includes(q)))
        .map((item) => ({
          id: item.id,
          name: item.name,
          sku: (item as { sku?: string | null }).sku ?? null,
          quantityOnHand: (item as { quantityOnHand?: number }).quantityOnHand ?? 0,
          reorderLevel: (item as { reorderLevel?: number | null }).reorderLevel ?? null,
          criticalLevel: (item as { criticalLevel?: number | null }).criticalLevel ?? null,
          stockStatus: (item as { stockStatus?: string | null }).stockStatus ?? null,
          sellingPrice: (item as { sellingPrice?: number | null }).sellingPrice ?? null,
          unitCost: (item as { unitCost?: number }).unitCost ?? 0,
        }));
      return paginate(products, args);
    },
  },
  {
    id: 'inventory.movements',
    domain: 'Inventory',
    description: 'Stock movement history, optionally per product.',
    type: 'read',
    risk: 'low',
    params: {
      productId: { type: 'string', description: 'Optional product id.' },
      ...PAGED,
      ...DATED,
    },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const productId = str(args.productId) ?? undefined;
      const movements = await listInventoryMovements(ctx.tenantId, productId);
      const ranged = movements.filter((movement) => inRange(movement.createdAt, args.from, args.to));
      return paginate(ranged, args);
    },
  },
  {
    id: 'inventory.lowstock',
    domain: 'Inventory',
    description: 'Products at or below reorder/critical levels or out of stock.',
    type: 'read',
    risk: 'low',
    params: { ...PAGED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const items = await getCatalog(ctx.tenantId);
      const low = items.filter(
        (item) =>
          item.type === 'product' &&
          ['out_of_stock', 'critical', 'low'].includes(((item as { stockStatus?: string | null }).stockStatus ?? '')),
      );
      return paginate(low, args);
    },
  },
  {
    id: 'inventory.valuation',
    domain: 'Inventory',
    description: 'Stock valuation at unit cost with per-product lines.',
    type: 'read',
    risk: 'low',
    params: {},
    roles: ALL_ROLES,
    handler: async (ctx) => {
      const items = await getCatalog(ctx.tenantId);
      const lines = items
        .filter((item) => item.type === 'product')
        .map((item) => {
          const quantity = (item as { quantityOnHand?: number }).quantityOnHand ?? 0;
          const unitCost = (item as { unitCost?: number }).unitCost ?? 0;
          return { id: item.id, name: item.name, quantityOnHand: quantity, unitCost, value: quantity * unitCost };
        });
      return { currencyCode: (await getTenantById(ctx.tenantId))?.currencyCode ?? 'KES', totalValue: lines.reduce((sum, line) => sum + line.value, 0), lines };
    },
  },
  {
    id: 'payments.list',
    domain: 'Payments',
    description: 'Payment attempts, optionally per order. Phone numbers are masked.',
    type: 'read',
    risk: 'low',
    params: {
      orderId: { type: 'string', description: 'Optional order id.' },
      status: { type: 'string', description: 'Optional payment status.' },
      ...PAGED,
    },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => {
      const payments = await getCommerceRepository().listPayments(ctx.tenantId, {
        orderId: str(args.orderId) ?? undefined,
        status: str(args.status) as never,
      });
      const masked = payments.map((payment) => ({ ...payment, customerPhone: maskCustomerPhone(payment.customerPhone ?? null) }));
      return paginate(masked, args);
    },
  },
  {
    id: 'payments.mpesa',
    domain: 'Payments',
    description: 'M-Pesa readiness for this shop (connection state, no secrets).',
    type: 'read',
    risk: 'low',
    params: {},
    roles: ADMIN_ROLES,
    handler: async (ctx) => getMpesaAvailability(getCommerceRepository(), ctx.tenantId),
  },
  {
    id: 'expenses.list',
    domain: 'Expenses',
    description: 'Recorded expenses.',
    type: 'read',
    risk: 'low',
    params: { ...PAGED, ...DATED },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => {
      const expenses = await listExpenses(ctx.tenantId);
      const ranged = expenses.filter((expense) => inRange(`${expense.expenseDate}T00:00:00.000Z`, args.from, args.to));
      return paginate(ranged, args);
    },
  },
  {
    id: 'expenses.get',
    domain: 'Expenses',
    description: 'One expense.',
    type: 'read',
    risk: 'low',
    params: { expenseId: { type: 'string', description: 'Expense id.', required: true } },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => {
      const found = (await listExpenses(ctx.tenantId)).find((item) => item.id === args.expenseId) ?? null;
      if (!found) {
        throw notFound('Expense');
      }
      return found;
    },
  },
  {
    id: 'payouts.list',
    domain: 'Payouts',
    description: 'Commission payouts.',
    type: 'read',
    risk: 'low',
    params: { ...PAGED },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => paginate(await listCommissionPayouts(ctx.tenantId), args),
  },
  {
    id: 'marketplace.list',
    domain: 'Marketplace',
    description: 'Marketplace ads visible to this shop.',
    type: 'read',
    risk: 'low',
    params: { ...PAGED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => paginate(await listMarketplaceFeed(ctx.tenantId, true), args),
  },
  {
    id: 'marketplace.get',
    domain: 'Marketplace',
    description: 'One marketplace advert.',
    type: 'read',
    risk: 'low',
    params: { advertId: { type: 'string', description: 'Advert id.', required: true } },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const found = (await listMarketplaceFeed(ctx.tenantId, true)).find((item) => item.id === args.advertId) ?? null;
      if (!found) {
        throw notFound('Advert');
      }
      return found;
    },
  },
  {
    id: 'sellerqr.pending',
    domain: 'Seller QR',
    description: 'Seller-QR orders awaiting review, with credential references (no secrets).',
    type: 'read',
    risk: 'low',
    params: { ...PAGED },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const [orders, credentials] = await Promise.all([
        listCommerceOrders(sessionOf(ctx), { ownOnly: ownOnly(ctx) }),
        listSellerCredentialsByTenant(ctx.tenantId),
      ]);
      const credentialById = new Map(credentials.map((credential) => [credential.id, credential]));
      const pending = orders
        .filter((order) => order.status === 'PENDING_REVIEW' && order.sellerCredentialId)
        .map((order) => ({
          ...order,
          credentialReference: credentialById.get(order.sellerCredentialId as string)?.publicReference ?? null,
        }));
      return paginate(pending, args);
    },
  },
  {
    id: 'sellerqr.order',
    domain: 'Seller QR',
    description: 'One seller-QR order with credential reference.',
    type: 'read',
    risk: 'low',
    params: { orderId: { type: 'string', description: 'Order id.', required: true } },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const order = await getCommerceOrder(sessionOf(ctx), String(args.orderId));
      if (!order || !order.sellerCredentialId || (ownOnly(ctx) && order.sellerId !== ctx.userId)) {
        throw notFound('Seller QR order');
      }
      const credentials = await listSellerCredentialsByTenant(ctx.tenantId);
      const credential = credentials.find((item) => item.id === order.sellerCredentialId) ?? null;
      return { ...order, credentialReference: credential?.publicReference ?? null, credentialStatus: credential?.status ?? null };
    },
  },
  {
    id: 'sellerqr.activity',
    domain: 'Seller QR',
    description: 'Orders and sales for one seller. Staff see only themselves.',
    type: 'read',
    risk: 'low',
    params: {
      sellerId: { type: 'string', description: 'Seller user id (defaults to caller).' },
      ...PAGED,
    },
    roles: ALL_ROLES,
    handler: async (ctx, args) => {
      const sellerId = ownOnly(ctx) ? ctx.userId : ((str(args.sellerId) ?? ctx.userId) as string);
      const [orders, sales] = await Promise.all([
        listCommerceOrders(sessionOf(ctx), {}),
        listCommerceSales(sessionOf(ctx), {}),
      ]);
      const sellerOrders = orders.filter((order) => order.sellerId === sellerId);
      const sellerSales = sales.filter((sale) => sale.sellerId === sellerId);
      return { sellerId, orders: paginate(sellerOrders, args), sales: paginate(sellerSales, { ...args }) };
    },
  },
  {
    id: 'attendance.records',
    domain: 'Attendance',
    description: 'Attendance records with optional date/employee/status filters.',
    type: 'read',
    risk: 'low',
    params: {
      date: { type: 'string', description: 'Optional YYYY-MM-DD attendance date.' },
      employeeId: { type: 'string', description: 'Optional employee user id.' },
      status: { type: 'string', description: 'Optional record status.' },
      openOnly: { type: 'boolean', description: 'Only currently open records.' },
      ...PAGED,
    },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => {
      const records = await listAttendanceRecordsByTenant(ctx.tenantId, {
        attendanceDate: str(args.date) ?? undefined,
        employeeId: str(args.employeeId) ?? undefined,
        status: str(args.status) ?? undefined,
        openOnly: args.openOnly === true,
      });
      return paginate(records, args);
    },
  },
  {
    id: 'attendance.daily',
    domain: 'Attendance',
    description: "One day's attendance sheet.",
    type: 'read',
    risk: 'low',
    params: { date: { type: 'string', description: 'YYYY-MM-DD date.', required: true } },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => {
      const date = str(args.date);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new AiError('INVALID_ARGUMENT', 'date must be YYYY-MM-DD.', false);
      }
      const [records, terminals] = await Promise.all([
        listAttendanceRecordsByTenant(ctx.tenantId, { attendanceDate: date }),
        listAttendanceTerminalsByTenant(ctx.tenantId),
      ]);
      return { date, records, activeTerminals: terminals.filter((terminal) => terminal.isActive).length };
    },
  },
  {
    id: 'attendance.terminals',
    domain: 'Attendance',
    description: 'Attendance terminals (token material never exposed).',
    type: 'read',
    risk: 'low',
    params: { ...PAGED },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => paginate(await listAttendanceTerminalsByTenant(ctx.tenantId), args),
  },
  {
    id: 'reports.monthly',
    domain: 'Reports',
    description: 'Monthly business report.',
    type: 'read',
    risk: 'low',
    params: { month: { type: 'string', description: 'Optional YYYY-MM month (default current).' } },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => {
      const month = typeof args.month === 'string' && /^\d{4}-\d{2}$/.test(args.month) ? new Date(`${args.month}-01T00:00:00.000Z`) : new Date();
      return getMonthlyReport(ctx.tenantId, month);
    },
  },
  {
    id: 'reports.financial',
    domain: 'Reports',
    description: 'Daily financial rows (income, expenses, payouts, product costs).',
    type: 'read',
    risk: 'low',
    params: { ...PAGED },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => paginate(await getFinancialRows(ctx.tenantId), args),
  },
  {
    id: 'platform.shops.list',
    domain: 'Platform',
    description: 'Enumerate real HAPOS shops with authoritative IDs (master authority only).',
    type: 'read',
    risk: 'low',
    params: { ...PAGED },
    roles: ['super_admin'],
    handler: async (_ctx, args) => {
      const tenants = await listTenantsStore();
      const shops = tenants.map((tenant) => ({
        shopId: tenant.id,
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
      }));
      return paginate(shops, args);
    },
  },
  {
    id: 'platform.events.since',
    domain: 'Platform',
    description: 'HAPOS state-transition events for this shop after a cursor.',
    type: 'read',
    risk: 'low',
    params: {
      cursor: { type: 'string', description: 'Exclusive event id cursor (default from beginning).' },
      entityType: { type: 'string', description: 'Optional entity filter.' },
      ...PAGED,
    },
    roles: ADMIN_ROLES,
    handler: async (ctx, args) => {
      const { listAiEvents } = await import('@/server/aegis/events');
      return listAiEvents(ctx.tenantId, {
        cursor: str(args.cursor),
        entityType: str(args.entityType),
        limit: Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 200),
      });
    },
  },
];
