-- HAPOS Phase 3 — seller credentials + sale amendments (additive, idempotent).
--
-- Apply AFTER all Phase 2/2A migrations, inside a transaction, against a
-- development or staging database only. Never run against production without
-- a migration runbook. Creates no data and modifies no existing rows.
--
-- Vocabulary parity is enforced by scripts/verify-phase-migrations.js against
-- src/server/commerce/seller.ts (SellerCredentialStatus).
--
-- Design notes:
-- - seller_credentials references users.id (existing staff identity — no new
--   identity type, no new role value). One ACTIVE credential per seller is
--   enforced by a partial unique index; history rows accumulate on rotation.
-- - Only token_hash is stored. The raw bearer is shown once at issuance /
--   rotation and never persisted. Indexed by public reference (QR lookup);
--   token verification is hash-compare after reference resolution.
-- - sale_amendments is the append-only audit trail for engine-owned
--   correction propagation (Phase 2A divergence closure). Original sale rows
--   are amended in place AND every amendment is recorded with before/after.

begin;

-- ── seller_credentials ─────────────────────────────────────────────────────

create table if not exists public.seller_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  seller_id uuid not null,
  public_reference text not null,
  token_hash text not null,
  status text not null default 'ACTIVE',
  issued_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  rotated_at timestamptz,
  rotated_from_id uuid,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_credential_status_check
    check (status in ('ACTIVE', 'REVOKED', 'EXPIRED')),
  constraint seller_credentials_seller_fk foreign key (tenant_id, seller_id)
    references public.users (tenant_id, id) on delete restrict,
  constraint seller_credentials_reference_unique unique (public_reference),
  constraint seller_credentials_tenant_id_id_unique unique (tenant_id, id)
);

-- Exactly one active credential per seller (history accumulates on rotation).
create unique index if not exists seller_credentials_active_unique_idx
  on public.seller_credentials (tenant_id, seller_id)
  where status = 'ACTIVE';

create index if not exists seller_credentials_reference_idx
  on public.seller_credentials (public_reference)
  where status = 'ACTIVE';

create index if not exists seller_credentials_seller_idx
  on public.seller_credentials (tenant_id, seller_id, created_at desc);

-- ── sale_amendments (engine-owned correction audit) ─────────────────────────

create table if not exists public.sale_amendments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_id uuid not null,
  previous_total numeric(12, 2) not null check (previous_total >= 0),
  new_total numeric(12, 2) not null check (new_total >= 0),
  field_changes jsonb not null default '[]'::jsonb,
  reason text not null,
  actor_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint sale_amendments_sale_fk foreign key (tenant_id, sale_id)
    references public.sales (tenant_id, id) on delete restrict,
  constraint sale_amendments_tenant_id_id_unique unique (tenant_id, id)
);

create index if not exists sale_amendments_sale_idx
  on public.sale_amendments (tenant_id, sale_id, created_at desc);

-- ── row-level security (mirrors established conventions) ───────────────────

alter table public.seller_credentials enable row level security;
alter table public.seller_credentials force row level security;
alter table public.sale_amendments enable row level security;
alter table public.sale_amendments force row level security;

drop policy if exists seller_credentials_select_policy on public.seller_credentials;
create policy seller_credentials_select_policy
on public.seller_credentials for select using (app.can_access_tenant(tenant_id));

drop policy if exists seller_credentials_insert_policy on public.seller_credentials;
create policy seller_credentials_insert_policy
on public.seller_credentials for insert with check (app.can_manage_tenant(tenant_id));

drop policy if exists seller_credentials_update_policy on public.seller_credentials;
create policy seller_credentials_update_policy
on public.seller_credentials for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists seller_credentials_delete_policy on public.seller_credentials;
create policy seller_credentials_delete_policy
on public.seller_credentials for delete using (app.is_super_admin());

drop policy if exists sale_amendments_select_policy on public.sale_amendments;
create policy sale_amendments_select_policy
on public.sale_amendments for select using (app.can_access_tenant(tenant_id));

drop policy if exists sale_amendments_insert_policy on public.sale_amendments;
create policy sale_amendments_insert_policy
on public.sale_amendments for insert with check (app.can_manage_tenant(tenant_id));

drop policy if exists sale_amendments_update_policy on public.sale_amendments;
create policy sale_amendments_update_policy
on public.sale_amendments for update
using (app.is_super_admin())
with check (app.is_super_admin());

drop policy if exists sale_amendments_delete_policy on public.sale_amendments;
create policy sale_amendments_delete_policy
on public.sale_amendments for delete using (app.is_super_admin());

commit;
