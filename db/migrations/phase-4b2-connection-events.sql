-- HAPOS Phase 4B closure — payment connection audit trail (additive).
--
-- Smallest safe audit entity: append-only rows with fixed vocabulary, no
-- JSON blobs (only two nullable reference columns), no secrets. One row per
-- lifecycle action: CONNECTED, VERIFIED, DISCONNECTED, RECONNECTED,
-- CREDENTIAL_ROTATED, ROTATION_FAILED, ENVIRONMENT_REJECTED, FOREIGN_MERCHANT_REJECTED.
--
-- RLS: readable by platform super_admin for operational support; writable
-- by the app role (service writes bypass RLS through the repository only in
-- server context; direct tenant-role writes are not granted).

begin;

create table if not exists public.payment_connection_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  connection_id uuid references public.payment_connections(id) on delete set null,
  action text not null,
  actor_id uuid references public.users(id),
  actor_role text,
  result text not null default 'OK',
  old_provider_reference text,
  new_provider_reference text,
  created_at timestamptz not null default now(),
  constraint payment_connection_event_action_check
    check (action in (
      'CONNECTED', 'VERIFIED', 'DISCONNECTED', 'RECONNECTED',
      'CREDENTIAL_ROTATED', 'ROTATION_FAILED',
      'ENVIRONMENT_REJECTED', 'FOREIGN_MERCHANT_REJECTED'
    )),
  constraint payment_connection_event_result_check
    check (result in ('OK', 'ERROR'))
);

create index if not exists payment_connection_events_tenant_created_idx
  on public.payment_connection_events (tenant_id, created_at desc);
create index if not exists payment_connection_events_connection_idx
  on public.payment_connection_events (connection_id)
  where connection_id is not null;

-- ── row-level security ─────────────────────────────────────────────────────

alter table public.payment_connection_events enable row level security;
alter table public.payment_connection_events force row level security;

drop policy if exists payment_connection_events_select_policy on public.payment_connection_events;
create policy payment_connection_events_select_policy
on public.payment_connection_events for select using (app.can_access_tenant(tenant_id));

-- No tenant-writable policies: the application service role records events;
-- shop admins and staff can read (via can_access_tenant) but never insert,
-- update or delete.

commit;
