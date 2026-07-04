import type { ReactNode } from 'react';
import Link from 'next/link';

import { FloatingAssistant } from '@/components/ai/floating-assistant';
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
  const workspaceMeta = session.tenant
    ? `${session.user.fullName} / ${userRoleLabel} / ${session.tenant.slug}`
    : `${session.user.fullName} / ${userRoleLabel}`;

  return (
    <div className="shell-grid">
      <Sidebar user={session.user} tenant={session.tenant} subscription={session.subscription} />
      <main className="workspace">
        <div className="workspace-inner">
          <header className="workspace-topbar">
            <div className="workspace-topbar-main">
              <div className="workspace-title-block">
                <p className="workspace-kicker">{workspaceLabel}</p>
                <h1 className="workspace-title">{workspaceName}</h1>
              </div>
            </div>

            <div className="workspace-topbar-actions">
              <span className="workspace-meta">{workspaceMeta}</span>
              <form action={logoutAction}>
                <button type="submit" className="button ghost">
                  Log out
                </button>
              </form>
            </div>
          </header>

          {children}
        </div>
      </main>
      <FloatingAssistant />
    </div>
  );
}
