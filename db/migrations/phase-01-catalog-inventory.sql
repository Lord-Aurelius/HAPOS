-- HAPOS Phase 1 — catalog + inventory engine (additive, idempotent).
--
-- Apply AFTER db/schema.sql, inside a transaction, against a development or
-- staging database only. Never run against production without the Phase 1
-- migration runbook. This file creates no data and modifies no existing rows.
--
-- Semantics:
--   products.quantity_on_hand = maintained balance/cache.
--   inventory_movements       = authoritative audit history.
--   Invariant: quantity_on_hand == opening + sum(all valid movements).
--   Movement `quantity` is a SIGNED delta (positive = stock in, negative = out).

begin;

-- ── products: merchant catalog columns (unit_cost keeps its cost meaning) ──

alter table public.products
  add column if not exists sku text,
  add column if not exists selling_price numeric(12, 2),
  add column if not exists quantity_on_hand integer not null default 0,
  add column if not exists reorder_level integer,
  add column if not exists critical_level integer,
  add column if not exists sku_generated boolean not null default false,
  add column if not exists updated_by uuid references public.users(id);

do $$
begin
  alter table public.products
    add constraint products_selling_price_check check (selling_price is null or selling_price >= 0);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.products
    add constraint products_quantity_on_hand_check check (quantity_on_hand >= 0);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.products
    add constraint products_reorder_level_check
    check (reorder_level is null or reorder_level >= 0);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.products
    add constraint products_critical_level_check
    check (critical_level is null or critical_level >= 0);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.products
    add constraint products_threshold_order_check
    check (critical_level is null or reorder_level is null or critical_level <= reorder_level);
exception
  when duplicate_object then null;
end $$;

-- One SKU per shop; null SKUs (uncatalogued legacy rows) are exempt.
create unique index if not exists products_tenant_sku_unique_idx
  on public.products (tenant_id, lower(sku))
  where sku is not null;

create index if not exists products_tenant_stock_idx
  on public.products (tenant_id, is_active, quantity_on_hand);

-- ── service_product_links: optional consumption definition (BOM) ─────────────
-- A definition only. Stock moves when a SALE completes, never because a link
-- exists.

create table if not exists public.service_product_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_id uuid not null,
  product_id uuid not null,
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  constraint service_product_links_service_fk foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete cascade,
  constraint service_product_links_product_fk foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete restrict,
  constraint service_product_links_tenant_service_product_unique unique (tenant_id, service_id, product_id),
  constraint service_product_links_tenant_id_id_unique unique (tenant_id, id)
);

create index if not exists service_product_links_service_idx
  on public.service_product_links (tenant_id, service_id);
create index if not exists service_product_links_product_idx
  on public.service_product_links (tenant_id, product_id);

-- ── inventory_movements: authoritative audit history ─────────────────────────
-- Movement-type semantics:
--   OPENING_BALANCE      initial counted stock for a product (quantity >= 0 delta from 0)
--   PURCHASE             stock received from a supplier (positive)
--   SALE                 retail units sold (negative)
--   SERVICE_CONSUMPTION  product consumed while performing a service (negative)
--   RETURN               customer/staff return back into stock (positive)
--   ADJUSTMENT           counted correction to a known physical quantity (signed)
--   DAMAGE               written off as damaged (negative)
--   LOSS                 written off as lost/expired (negative)
--   TRANSFER_IN          received from another branch/shop (positive)
--   TRANSFER_OUT         sent to another branch/shop (negative)
--   MIGRATED_USAGE       legacy service_record_products relabelled at migration
--                        (informational only — never proof of present stock)

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  quantity integer not null check (quantity <> 0),
  movement_type text not null check (movement_type in (
    'OPENING_BALANCE', 'PURCHASE', 'SALE', 'SERVICE_CONSUMPTION', 'RETURN',
    'ADJUSTMENT', 'DAMAGE', 'LOSS', 'TRANSFER_IN', 'TRANSFER_OUT',
    'MIGRATED_USAGE'
  )),
  reference_type text,
  reference_id uuid,
  unit_cost numeric(12, 2) check (unit_cost is null or unit_cost >= 0),
  previous_quantity integer not null check (previous_quantity >= 0),
  resulting_quantity integer not null check (resulting_quantity >= 0),
  reason text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint inventory_movements_product_fk foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete restrict,
  constraint inventory_movements_balance_check
    check (resulting_quantity = previous_quantity + quantity),
  constraint inventory_movements_tenant_id_id_unique unique (tenant_id, id)
);

create index if not exists inventory_movements_product_time_idx
  on public.inventory_movements (tenant_id, product_id, created_at desc);
create index if not exists inventory_movements_reference_idx
  on public.inventory_movements (tenant_id, reference_type, reference_id)
  where reference_type is not null;
create index if not exists inventory_movements_type_time_idx
  on public.inventory_movements (tenant_id, movement_type, created_at desc);

-- ── row-level security (mirrors db/schema.sql conventions) ──────────────────

alter table public.service_product_links enable row level security;
alter table public.service_product_links force row level security;
alter table public.inventory_movements enable row level security;
alter table public.inventory_movements force row level security;

-- BOM definitions: readable shop-wide, managed by admins.
drop policy if exists service_product_links_select_policy on public.service_product_links;
create policy service_product_links_select_policy
on public.service_product_links
for select
using (app.can_access_tenant(tenant_id));

drop policy if exists service_product_links_insert_policy on public.service_product_links;
create policy service_product_links_insert_policy
on public.service_product_links
for insert
with check (app.can_manage_tenant(tenant_id));

drop policy if exists service_product_links_update_policy on public.service_product_links;
create policy service_product_links_update_policy
on public.service_product_links
for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists service_product_links_delete_policy on public.service_product_links;
create policy service_product_links_delete_policy
on public.service_product_links
for delete
using (app.can_manage_tenant(tenant_id));

-- Movements: append-only for writers (no update/delete via RLS except admins
-- correcting linkage metadata); inserts restricted to shop managers so the
-- future seller role cannot post stock directly — stock moves via sales.
drop policy if exists inventory_movements_select_policy on public.inventory_movements;
create policy inventory_movements_select_policy
on public.inventory_movements
for select
using (app.can_access_tenant(tenant_id));

drop policy if exists inventory_movements_insert_policy on public.inventory_movements;
create policy inventory_movements_insert_policy
on public.inventory_movements
for insert
with check (app.can_manage_tenant(tenant_id));

drop policy if exists inventory_movements_update_policy on public.inventory_movements;
create policy inventory_movements_update_policy
on public.inventory_movements
for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists inventory_movements_delete_policy on public.inventory_movements;
create policy inventory_movements_delete_policy
on public.inventory_movements
for delete
using (app.is_super_admin());

commit;
