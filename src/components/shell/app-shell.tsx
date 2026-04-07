import type { ReactNode } from 'react';
import Link from 'next/link';

import { HaposLogo } from '@/components/branding/hapos-logo';
import { Sidebar } from '@/components/shell/sidebar';
import type { AppSession } from '@/lib/types';
import { logoutAction } from '@/server/actions/hapos';

type AppShellProps = {
  session: AppSession;
  children: ReactNode;
};

export function AppShell({ session, children }: AppShellProps) {
  const homeHref = session.user.role === 'super_admin' ? '/super/tenants' : '/app/dashboard';
  const workspaceName = session.tenant?.name ?? 'HAPOS Platform';
  const workspaceLabel = session.tenant ? 'Business workspace' : 'Platform workspace';
  const userRoleLabel = session.user.role.replace('_', ' ');

  return (
    <div className="shell-grid">
      <Sidebar user={session.user} tenant={session.tenant} subscription={session.subscription} />
      <main className="workspace">
        <div className="workspace-inner">
          <header className="workspace-topbar">
            <div className="workspace-topbar-main">
              <Link href={homeHref} className="workspace-brand-link">
                <HaposLogo compact />
              </Link>
              <div className="workspace-title-block">
                <p className="hero-kicker">{workspaceLabel}</p>
                <div className="workspace-title">{workspaceName}</div>
                <p className="workspace-subtitle">
                  {session.user.fullName} / {userRoleLabel}
                  {session.tenant ? ` / ${session.tenant.slug}` : ''}
                </p>
              </div>
            </div>

            <div className="workspace-topbar-actions">
              {session.tenant ? <span className="pill">Shop name: {session.tenant.name}</span> : <span className="pill">Super admin</span>}
              <form action={logoutAction}>
                <button type="submit" className="button secondary">
                  Log out
                </button>
              </form>
            </div>
          </header>

          {children}
        </div>
      </main>
    </div>
  );
}
