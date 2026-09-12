-- HAPOS Phase 4 — payments (additive, idempotent).
--
-- Apply AFTER all Phase 3 migrations, inside a transaction, against a
-- development or staging database only. Never run against production without
-- a migration runbook. Creates no data and modifies no existing rows.
--
-- Vocabulary parity is enforced by scripts/verify-phase-migrations.js against
-- src/server/commerce/payments.ts (PaymentStatus, PaymentProvider,
-- PaymentMethod).
--
-- Design notes (sale ≠ payment):
-- - a payment records HOW money moved; a sale records WHAT was sold. Cash
--   payments are real rows (provider INTERNAL, status SUCCESS at completion)
--   so reconciliation sees a uniform model — never a fake M-Pesa success.
-- - M-Pesa rows start PENDING with a provider request id; callbacks move
--   them to SUCCESS/FAILED/EXPIRED via domain transitions only.
-- - needs_recovery marks the money-safety exception: provider reports
--   SUCCESS but sale finalization could not complete (e.g. stock vanished).
--   Recovery retries finalization; refunds are out of scope unless PaymentOS
--   documents a reversal flow.
-- - retries create NEW rows (attempt_number increments) against the same
--   order; idempotency keys are per attempt.

begin;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid,
  sale_id uuid,
  provider text not null default 'PAYMENTOS',
  method text not null default 'MPESA',
  status text not null default 'PENDING',
  amount numeric(12, 2) not null check (amount >= 0),
  currency_code char(3) not null default 'KES',
  customer_phone text,
  provider_reference text,
  provider_request_id text,
  idempotency_key text,
  attempt_number integer not null default 1 check (attempt_number > 0),
  initiated_at timestamptz not null default now(),
  confirmed_at timestamptz,
  failed_at timestamptz,
  expires_at timestamptz,
  failure_code text,
  failure_reason text,
  needs_recovery boolean not null default false,
  recovery_reason text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_status_check
    check (status in ('PENDING', 'SUCCESS', 'FAILED', 'EXPIRED', 'CANCELLED')),
  constraint payment_provider_check
    check (provider in ('PAYMENTOS', 'INTERNAL')),
  constraint payment_method_check
    check (method in ('CASH', 'MPESA')),
  constraint payments_order_fk foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete restrict,
  constraint payments_sale_fk foreign key (tenant_id, sale_id)
    references public.sales (tenant_id, id) on delete restrict,
  constraint payments_customer_phone_check
    check (customer_phone is null or customer_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint payments_success_timestamps_check
    check ((status = 'SUCCESS') = (confirmed_at is not null)),
  constraint payments_failed_timestamps_check
    check (status not in ('FAILED', 'EXPIRED', 'CANCELLED') or failed_at is not null),
  constraint payments_tenant_id_id_unique unique (tenant_id, id)
);

create unique index if not exists payments_tenant_idempotency_unique_idx
  on public.payments (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists payments_tenant_status_idx
  on public.payments (tenant_id, status, created_at desc);
create index if not exists payments_tenant_order_idx
  on public.payments (tenant_id, order_id)
  where order_id is not null;
create index if not exists payments_provider_reference_idx
  on public.payments (tenant_id, provider, provider_reference)
  where provider_reference is not null;
create index if not exists payments_recovery_idx
  on public.payments (tenant_id, created_at desc)
  where needs_recovery;

-- ── row-level security (mirrors established conventions) ───────────────────

alter table public.payments enable row level security;
alter table public.payments force row level security;

drop policy if exists payments_select_policy on public.payments;
create policy payments_select_policy
on public.payments for select using (app.can_access_tenant(tenant_id));

drop policy if exists payments_insert_policy on public.payments;
create policy payments_insert_policy
on public.payments for insert with check (app.can_record_services(tenant_id));

drop policy if exists payments_update_policy on public.payments;
create policy payments_update_policy
on public.payments for update
using (app.can_record_services(tenant_id))
with check (app.can_record_services(tenant_id));

drop policy if exists payments_delete_policy on public.payments;
create policy payments_delete_policy
on public.payments for delete using (app.is_super_admin());

commit;
