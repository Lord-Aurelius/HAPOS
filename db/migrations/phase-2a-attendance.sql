-- HAPOS Phase 2A — staff attendance (additive, idempotent).
--
-- Apply AFTER db/schema.sql, phase-01 and phase-02 migrations, inside a
-- transaction, against a development or staging database only. Never run
-- against production without a migration runbook. Creates no data and
-- modifies no existing rows. No attendance history is fabricated: new tables
-- start empty; existing users keep working (employee_number nullable).
--
-- Vocabulary parity is enforced by scripts/verify-phase-migrations.js against
-- src/server/commerce/attendance.ts (AttendanceStatus).
--
-- Design notes:
-- - users.employee_number is the reusable employee identity (no second table).
-- - attendance_terminals: exactly one row per tenant (unique tenant_id). The
--   QR carries the public `reference` only; `token_hash` never leaves the DB.
-- - attendance_records: one open record per employee enforced by a partial
--   unique index on (tenant_id, employee_id) WHERE check_out_at IS NULL, plus
--   application-level checks inside the write transaction.
-- - attendance_date is the merchant-local calendar date; check_in/out_at are
--   absolute UTC timestamps recorded by the server clock.

begin;

-- ── users: minimal employee-number identity ────────────────────────────────

alter table public.users
  add column if not exists employee_number text;

create unique index if not exists users_tenant_employee_number_unique_idx
  on public.users (tenant_id, lower(employee_number))
  where employee_number is not null;

-- ── attendance_terminals: one QR-able terminal per merchant ────────────────

create table if not exists public.attendance_terminals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  reference text not null,
  token_hash text not null,
  is_active boolean not null default true,
  revoked_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_terminals_tenant_unique unique (tenant_id),
  constraint attendance_terminals_reference_unique unique (reference),
  constraint attendance_terminals_tenant_id_id_unique unique (tenant_id, id)
);

create index if not exists attendance_terminals_reference_idx
  on public.attendance_terminals (reference)
  where is_active;

-- ── attendance_records ─────────────────────────────────────────────────────

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null,
  employee_number_snapshot text not null,
  attendance_date date not null,
  check_in_at timestamptz not null,
  check_out_at timestamptz,
  status text not null default 'CHECKED_IN',
  terminal_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_status_check
    check (status in ('CHECKED_IN', 'CHECKED_OUT')),
  constraint attendance_records_employee_fk foreign key (tenant_id, employee_id)
    references public.users (tenant_id, id) on delete restrict,
  constraint attendance_records_checkout_order_check
    check (check_out_at is null or check_out_at >= check_in_at),
  constraint attendance_records_status_consistency_check
    check ((status = 'CHECKED_OUT') = (check_out_at is not null)),
  constraint attendance_records_tenant_id_id_unique unique (tenant_id, id)
);

-- One open attendance record per employee per tenant.
create unique index if not exists attendance_records_open_unique_idx
  on public.attendance_records (tenant_id, employee_id)
  where check_out_at is null;

create index if not exists attendance_records_employee_date_idx
  on public.attendance_records (tenant_id, employee_id, attendance_date desc);
create index if not exists attendance_records_tenant_date_idx
  on public.attendance_records (tenant_id, attendance_date desc);
create index if not exists attendance_records_open_lookup_idx
  on public.attendance_records (tenant_id, check_in_at desc)
  where check_out_at is null;

-- ── row-level security (mirrors schema.sql conventions) ────────────────────

alter table public.attendance_terminals enable row level security;
alter table public.attendance_terminals force row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_records force row level security;

drop policy if exists attendance_terminals_select_policy on public.attendance_terminals;
create policy attendance_terminals_select_policy
on public.attendance_terminals for select using (app.can_access_tenant(tenant_id));

drop policy if exists attendance_terminals_insert_policy on public.attendance_terminals;
create policy attendance_terminals_insert_policy
on public.attendance_terminals for insert with check (app.can_manage_tenant(tenant_id));

drop policy if exists attendance_terminals_update_policy on public.attendance_terminals;
create policy attendance_terminals_update_policy
on public.attendance_terminals for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists attendance_terminals_delete_policy on public.attendance_terminals;
create policy attendance_terminals_delete_policy
on public.attendance_terminals for delete using (app.is_super_admin());

drop policy if exists attendance_records_select_policy on public.attendance_records;
create policy attendance_records_select_policy
on public.attendance_records for select using (app.can_access_tenant(tenant_id));

drop policy if exists attendance_records_insert_policy on public.attendance_records;
create policy attendance_records_insert_policy
on public.attendance_records for insert with check (app.can_record_services(tenant_id));

drop policy if exists attendance_records_update_policy on public.attendance_records;
create policy attendance_records_update_policy
on public.attendance_records for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists attendance_records_delete_policy on public.attendance_records;
create policy attendance_records_delete_policy
on public.attendance_records for delete using (app.is_super_admin());

commit;
