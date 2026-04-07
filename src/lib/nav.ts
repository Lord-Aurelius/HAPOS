import type { UserRole } from '@/lib/types';

export type NavItem = {
  href: string;
  label: string;
  roles: UserRole[];
  requiresPlatinum?: boolean;
};

export const shopNav: NavItem[] = [
  { href: '/app/dashboard', label: 'Dashboard', roles: ['shop_admin', 'super_admin', 'staff'] },
  { href: '/app/service-entry', label: 'Service Entry', roles: ['shop_admin', 'super_admin', 'staff'] },
  { href: '/app/sales', label: 'Sales Ledger', roles: ['shop_admin', 'super_admin'] },
  { href: '/app/customers', label: 'Customers', roles: ['shop_admin', 'super_admin', 'staff'] },
  { href: '/app/services', label: 'Price List', roles: ['shop_admin', 'super_admin', 'staff'] },
  { href: '/app/products', label: 'Products', roles: ['shop_admin', 'super_admin'] },
  { href: '/app/marketplace', label: 'Marketplace', roles: ['shop_admin', 'staff'], requiresPlatinum: true },
  { href: '/app/commissions', label: 'Commissions', roles: ['shop_admin', 'super_admin', 'staff'] },
  { href: '/app/expenses', label: 'Expenses', roles: ['shop_admin', 'super_admin'] },
  { href: '/app/reports/monthly', label: 'Monthly Report', roles: ['shop_admin', 'super_admin'] },
  { href: '/app/history', label: 'History & Export', roles: ['shop_admin', 'super_admin'] },
  { href: '/app/sms', label: 'SMS Center', roles: ['shop_admin', 'super_admin'] },
  { href: '/app/subscription', label: 'Subscription', roles: ['shop_admin', 'super_admin'] },
  { href: '/app/settings/staff', label: 'Staff', roles: ['shop_admin', 'super_admin'] },
  { href: '/app/settings/loyalty', label: 'Loyalty', roles: ['shop_admin', 'super_admin'] },
];

export const superNav: NavItem[] = [
  { href: '/super/tenants', label: 'Tenants', roles: ['super_admin'] },
  { href: '/super/marketplace', label: 'Marketplace', roles: ['super_admin'] },
];

export const customerNav = [
  { href: '/customer/dashboard', label: 'My Visits' },
  { href: '/customer/services', label: 'Price List' },
  { href: '/customer/marketplace', label: 'Marketplace', requiresPlatinum: true },
];
