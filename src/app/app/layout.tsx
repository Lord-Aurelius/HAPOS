import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import { requireSession } from '@/server/auth/demo-session';

export default async function ShopLayout({ children }: Readonly<{ children: ReactNode }>) {
  const session = await requireSession(['shop_admin', 'staff', 'super_admin']);

  return <AppShell session={session}>{children}</AppShell>;
}
