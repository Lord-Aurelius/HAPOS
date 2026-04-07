export type UserRole = 'super_admin' | 'shop_admin' | 'staff';

export type AuthContext = {
  userId: string;
  tenantId: string | null;
  role: UserRole;
};

export type SubscriptionSnapshot = {
  tenantId: string;
  tenantStatus: 'active' | 'suspended' | 'inactive';
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'expired' | 'suspended' | 'cancelled';
  endsAt: string;
  graceEndsAt?: string | null;
};

export type QueryableClient = {
  query: (sql: string, values?: unknown[]) => Promise<unknown>;
};

export async function applyTenantSession(client: QueryableClient, ctx: AuthContext): Promise<void> {
  await client.query(
    `
      select
        set_config('app.user_id', $1, true),
        set_config('app.user_role', $2, true),
        set_config('app.tenant_id', coalesce($3::text, ''), true)
    `,
    [ctx.userId, ctx.role, ctx.tenantId],
  );
}

export function assertTenantIsActive(snapshot: SubscriptionSnapshot, now = new Date()): void {
  if (snapshot.tenantStatus === 'suspended') {
    throw new Error('Tenant access is suspended by super admin.');
  }

  const graceDeadline = snapshot.graceEndsAt ? new Date(snapshot.graceEndsAt) : new Date(snapshot.endsAt);
  const activeStatuses = new Set(['trialing', 'active', 'past_due']);

  if (!activeStatuses.has(snapshot.subscriptionStatus)) {
    throw new Error('Subscription is not active.');
  }

  if (graceDeadline.getTime() < now.getTime()) {
    throw new Error('Subscription has expired.');
  }
}

export function canManageShop(role: UserRole): boolean {
  return role === 'super_admin' || role === 'shop_admin';
}

export function canRecordServices(role: UserRole): boolean {
  return role === 'super_admin' || role === 'shop_admin' || role === 'staff';
}
