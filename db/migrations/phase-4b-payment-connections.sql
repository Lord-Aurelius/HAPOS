-- HAPOS Phase 4B — payment connections (additive, idempotent).
--
-- Apply AFTER phase-04b-tenant-policy.sql, inside a transaction, against a
-- development or staging database only. Creates no data and modifies no
-- existing rows beyond adding nullable columns.
--
-- One active connection per tenant per environment is enforced with a
-- partial unique index on (tenant_id, environment) where status =
-- 'CONNECTED'. Historical payments keep working after disconnection: they
-- reference the connection row by id and store a provider merchant
-- snapshot, never a live join to "whatever is connected now".
--
-- Vocabulary parity with src/server/payments/connection.ts is enforced by
-- scripts/verify-phase-migrations.js.

begin;

create table if not exists public.payment_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null default 'PAYMENTOS',
  provider_tenant_id text,
  environment text not null default 'SANDBOX',
  status text not null default 'NOT_CONNECTED',
  display_name text,
  supported_methods text[] not null default '{}',
  connected_at timestamptz,
  last_verified_at timestamptz,
  disconnected_at timestamptz,
  last_check_code text,
  last_check_message text,
  secret_sealed text,
  webhook_secret_sealed text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_connection_provider_check
    check (provider in ('PAYMENTOS')),
  constraint payment_connection_environment_check
    check (environment in ('SANDBOX', 'PRODUCTION')),
  constraint payment_connection_status_check
    check (status in ('NOT_CONNECTED', 'CONNECTING', 'CONNECTED', 'ERROR', 'DISCONNECTED')),
  constraint payment_connection_identity_unique unique (tenant_id, provider, provider_tenant_id),
  constraint payment_connections_tenant_id_id_unique unique (tenant_id, id)
);

create unique index if not exists payment_connections_one_active_idx
  on public.payment_connections (tenant_id, environment)
  where status = 'CONNECTED';

create index if not exists payment_connections_tenant_status_idx
  on public.payment_connections (tenant_id, status);

-- ── payments: retain which connection + merchant produced each payment ────

alter table public.payments
  add column if not exists payment_connection_id uuid,
  add column if not exists provider_merchant_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_connection_fk'
  ) then
    alter table public.payments
      add constraint payments_connection_fk foreign key (tenant_id, payment_connection_id)
      references public.payment_connections (tenant_id, id) on delete restrict;
  end if;
end $$;

create index if not exists payments_tenant_connection_idx
  on public.payments (tenant_id, payment_connection_id)
  where payment_connection_id is not null;

-- ── row-level security (mirrors established conventions) ───────────────────
-- Shop admins manage their own tenant's connection; staff have no access;
-- super_admin retains operational support, explicitly tenant-scoped by
-- app.can_access_tenant.

alter table public.payment_connections enable row level security;
alter table public.payment_connections force row level security;

drop policy if exists payment_connections_select_policy on public.payment_connections;
create policy payment_connections_select_policy
on public.payment_connections for select using (app.can_access_tenant(tenant_id));

drop policy if exists payment_connections_insert_policy on public.payment_connections;
create policy payment_connections_insert_policy
on public.payment_connections for insert with check (app.can_manage_tenant(tenant_id));

drop policy if exists payment_connections_update_policy on public.payment_connections;
create policy payment_connections_update_policy
on public.payment_connections for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists payment_connections_delete_policy on public.payment_connections;
create policy payment_connections_delete_policy
on public.payment_connections for delete using (app.is_super_admin());

commit;
