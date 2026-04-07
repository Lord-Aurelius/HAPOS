import type { ReactNode } from 'react';
import Link from 'next/link';

import { HaposLogo } from '@/components/branding/hapos-logo';
import { customerNav } from '@/lib/nav';
import { subscriptionIncludesCustomerMarketplace } from '@/lib/plans';
import type { CustomerAppSession } from '@/lib/types';
import { customerLogoutAction } from '@/server/actions/hapos';

type CustomerShellProps = {
  session: CustomerAppSession;
  children: ReactNode;
};

export function CustomerShell({ session, children }: CustomerShellProps) {
  const visibleNav = customerNav.filter(
    (item) => !item.requiresPlatinum || subscriptionIncludesCustomerMarketplace(session.subscription),
  );

  return (
    <main className="workspace">
      <div className="workspace-inner">
        <header className="workspace-topbar">
          <div className="workspace-topbar-main">
            <Link href="/customer/dashboard" className="workspace-brand-link">
              <HaposLogo compact />
            </Link>
            <div className="workspace-title-block">
              <p className="hero-kicker">Customer portal</p>
              <div className="workspace-title">{session.tenant.name}</div>
              <p className="workspace-subtitle">
                {session.customer.name} / {session.customer.phoneE164}
              </p>
            </div>
          </div>

          <div className="workspace-topbar-actions">
            <span className="pill">{session.tenant.name}</span>
            <Link
              href={`/book/${session.tenant.slug}?phone=${encodeURIComponent(session.customer.phoneE164 || session.customer.phone)}`}
              className="button"
            >
              Book visit
            </Link>
            <form action={customerLogoutAction}>
              <button type="submit" className="button secondary">
                Log out
              </button>
            </form>
          </div>
        </header>

        <nav className="customer-nav">
          {visibleNav.map((item) => (
            <Link key={item.href} href={item.href} className="button secondary">
              {item.label}
            </Link>
          ))}
        </nav>

        {children}
      </div>
    </main>
  );
}
