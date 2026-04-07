'use client';

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
  const items = user.role === 'super_admin' ? superNav : shopNav;
  const visible = items
    .filter((item) => item.roles.includes(user.role))
    .filter((item) => !item.requiresPlatinum || subscriptionIncludesMarketplace(subscription));

  return (
    <aside className="sidebar">
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
  );
}
