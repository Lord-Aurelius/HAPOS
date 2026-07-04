'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BrainCircuit,
  PenSquare,
  Receipt,
  Users,
  Tags,
  Package,
  Store,
  DollarSign,
  CreditCard,
  BarChart3,
  History,
  MessageSquare,
  Crown,
  UserCog,
  Heart,
  Building2,
  LogOut,
  Menu,
  X,
} from 'lucide-react';

import { HaposLogo } from '@/components/branding/hapos-logo';
import { shopNav, superNav } from '@/lib/nav';
import { subscriptionIncludesMarketplace } from '@/lib/plans';
import type { Subscription, Tenant, User } from '@/lib/types';

type SidebarProps = {
  user: User;
  tenant: Tenant | null;
  subscription: Subscription | null;
};

const iconMap: Record<string, typeof LayoutDashboard> = {
  '/app/dashboard': LayoutDashboard,
  '/app/ai-dashboard': BrainCircuit,
  '/app/service-entry': PenSquare,
  '/app/sales': Receipt,
  '/app/customers': Users,
  '/app/services': Tags,
  '/app/products': Package,
  '/app/marketplace': Store,
  '/app/commissions': DollarSign,
  '/app/expenses': CreditCard,
  '/app/reports/monthly': BarChart3,
  '/app/history': History,
  '/app/sms': MessageSquare,
  '/app/subscription': Crown,
  '/app/settings/staff': UserCog,
  '/app/settings/loyalty': Heart,
  '/super/tenants': Building2,
  '/super/marketplace': Store,
};

const sections: Array<{ label: string; paths: string[] }> = [
  { label: 'Overview', paths: ['/app/dashboard', '/app/ai-dashboard'] },
  { label: 'Operations', paths: ['/app/service-entry', '/app/sales', '/app/customers', '/app/services', '/app/products'] },
  { label: 'Commerce', paths: ['/app/marketplace', '/app/commissions', '/app/expenses'] },
  { label: 'Reports', paths: ['/app/reports/monthly', '/app/history', '/app/sms'] },
  { label: 'Admin', paths: ['/app/subscription', '/app/settings/staff', '/app/settings/loyalty'] },
];

export function Sidebar({ user, tenant, subscription }: SidebarProps) {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const items = user.role === 'super_admin' ? superNav : shopNav;
  const visible = items
    .filter((item) => item.roles.includes(user.role))
    .filter((item) => !item.requiresPlatinum || subscriptionIncludesMarketplace(subscription));

  const visiblePaths = new Set(visible.map((i) => i.href));

  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobileOpen) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isMobileOpen]);

  const userInitial = user.fullName?.trim().charAt(0).toUpperCase() || 'U';

  return (
    <>
      <button
        type="button"
        className="mobile-sidebar-trigger"
        onClick={() => setIsMobileOpen((current) => !current)}
        aria-expanded={isMobileOpen}
        aria-controls="workspace-sidebar"
      >
        {isMobileOpen ? <X size={18} /> : <Menu size={18} />}
        {isMobileOpen ? 'Close' : 'Menu'}
      </button>

      <button
        type="button"
        className="mobile-sidebar-backdrop"
        data-open={isMobileOpen}
        aria-hidden={!isMobileOpen}
        tabIndex={isMobileOpen ? 0 : -1}
        onClick={() => setIsMobileOpen(false)}
      />

      <aside id="workspace-sidebar" className="sidebar" data-mobile-open={isMobileOpen}>
        <div className="sidebar-header">
          <HaposLogo compact />
        </div>

        <nav className="sidebar-nav">
          {user.role !== 'super_admin' ? (
            sections.map((section) => {
              const sectionItems = visible.filter((item) => section.paths.includes(item.href));
              if (sectionItems.length === 0) {return null;}

              return (
                <div key={section.label}>
                  <span className="sidebar-section-label">{section.label}</span>
                  {sectionItems.map((item) => {
                    const Icon = iconMap[item.href] || LayoutDashboard;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="sidebar-link"
                        data-active={pathname === item.href}
                      >
                        <Icon />
                        <span>{item.label}</span>
                        {item.href.includes('/super') ? <span className="sidebar-badge">Global</span> : null}
                      </Link>
                    );
                  })}
                </div>
              );
            })
          ) : (
            visible.map((item) => {
              const Icon = iconMap[item.href] || LayoutDashboard;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="sidebar-link"
                  data-active={pathname === item.href}
                >
                  <Icon />
                  <span>{item.label}</span>
                  {item.href.includes('/super') ? <span className="sidebar-badge">Global</span> : null}
                </Link>
              );
            })
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{userInitial}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user.fullName}</div>
              <div className="sidebar-user-role">{user.role.replace('_', ' ')}</div>
            </div>
          </div>
          <form action="/api/v1/auth/logout" method="post">
            <button type="submit" className="sidebar-logout">
              <LogOut size={16} />
              Logout
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
