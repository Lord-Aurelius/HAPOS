'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { HaposLogo } from '@/components/branding/hapos-logo';
import { shopNav, superNav } from '@/lib/nav';
import { subscriptionIncludesMarketplace } from '@/lib/plans';
import type { Subscription, Tenant, User } from '@/lib/types';

type SidebarProps = {
  user: User;
  tenant: Tenant | null;
  subscription: Subscription | null;
};

export function Sidebar({ user, tenant, subscription }: SidebarProps) {
  const pathname = usePathname();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const items = user.role === 'super_admin' ? superNav : shopNav;
  const visible = items
    .filter((item) => item.roles.includes(user.role))
    .filter((item) => !item.requiresPlatinum || subscriptionIncludesMarketplace(subscription));

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

  return (
    <>
      <button
        type="button"
        className="mobile-sidebar-trigger"
        onClick={() => setIsMobileOpen((current) => !current)}
        aria-expanded={isMobileOpen}
        aria-controls="workspace-sidebar"
      >
        {isMobileOpen ? 'Close menu' : 'Open menu'}
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
        <div className="brand-mark">
          <HaposLogo compact />
        </div>

        {tenant ? <div className="pill" style={{ marginBottom: 18 }}>{tenant.name}</div> : null}

        <div className="sidebar-group">
          {visible.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="sidebar-link"
              data-active={pathname === item.href}
            >
              <span>{item.label}</span>
              <span className="sidebar-badge">{item.href.includes('/super') ? 'Global' : 'Shop'}</span>
            </Link>
          ))}
        </div>

        <div className="sidebar-footer">
          <div>{user.fullName}</div>
          <div>{tenant?.name ?? 'Platform access'}</div>
          <div>{user.role.replace('_', ' ')}</div>
          <form action="/api/v1/auth/logout" method="post" style={{ marginTop: 16 }}>
            <button type="submit" className="button secondary" style={{ width: '100%' }}>
              Logout
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
