-- HAPOS Phase 2 — orders + sales engine (additive, idempotent).
--
-- Apply AFTER db/schema.sql and db/migrations/phase-01-catalog-inventory.sql,
-- inside a transaction, against a development or staging database only.
-- Never run against production without the Phase 2 migration runbook.
-- Creates no data and modifies no existing rows. service_records and
-- customerOrders stay intact; the engine coexists via compatibility writes.
--
-- Vocabulary parity is enforced by scripts/verify-phase-migrations.js against
-- src/server/commerce/orders.ts (OrderStatus, SaleStatus).

begin;

-- ── orders ───────────────────────────────────────────────────────────────────
-- DRAFT → SUBMITTED → PENDING_REVIEW → APPROVED → COMPLETED, with terminal
-- CANCELLED / REJECTED. Transitions are enforced application-side; the CHECK
-- below only bounds the vocabulary. Sources SELLER_QR / CUSTOMER_SELF_SERVICE
-- / API are vocabulary reserved for later phases (no producers yet).

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid,
  seller_id uuid,
  status text not null default 'DRAFT',
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  currency_code char(3) not null default 'KES',
  source text not null default 'STAFF',
  notes text,
  idempotency_key text,
  quoted_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.users(id),
  completed_at timestamptz,
  cancelled_at timestamptz,
  rejected_at timestamptz,
  rejection_reason text,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_status_check
    check (status in (
      'DRAFT', 'SUBMITTED', 'PENDING_REVIEW', 'APPROVED',
      'COMPLETED', 'CANCELLED', 'REJECTED'
    )),
  constraint order_source_check
    check (source in (
      'ADMIN', 'STAFF', 'CUSTOMER_BOOKING',
      'SELLER_QR', 'CUSTOMER_SELF_SERVICE', 'API'
    )),
  constraint orders_customer_fk foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint orders_seller_fk foreign key (tenant_id, seller_id)
    references public.users (tenant_id, id) on delete restrict,
  constraint orders_tenant_id_id_unique unique (tenant_id, id)
);

create unique index if not exists orders_tenant_idempotency_unique_idx
  on public.orders (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists orders_tenant_status_idx
  on public.orders (tenant_id, status, created_at desc);
create index if not exists orders_tenant_customer_idx
  on public.orders (tenant_id, customer_id)
  where customer_id is not null;
create index if not exists orders_tenant_seller_idx
  on public.orders (tenant_id, seller_id)
  where seller_id is not null;

-- ── order_items ──────────────────────────────────────────────────────────────
-- Exactly one catalog reference per line (never both, never neither).

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  item_type text not null check (item_type in ('PRODUCT', 'SERVICE')),
  product_id uuid,
  service_id uuid,
  quantity integer not null check (quantity > 0),
  catalog_unit_price numeric(12, 2) not null check (catalog_unit_price >= 0),
  actual_unit_price numeric(12, 2) not null check (actual_unit_price >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  item_name text not null,
  item_snapshot jsonb not null default '{}'::jsonb,
  commission_type public.commission_type not null default 'percentage',
  commission_value numeric(12, 2) not null default 0 check (commission_value >= 0),
  commission_amount numeric(12, 2) not null default 0 check (commission_amount >= 0),
  override_reason text,
  override_by uuid references public.users(id),
  override_at timestamptz,
  created_at timestamptz not null default now(),
  constraint order_items_order_fk foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete cascade,
  constraint order_items_product_fk foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete restrict,
  constraint order_items_service_fk foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete restrict,
  constraint order_items_single_reference_check
    check (num_nonnulls(product_id, service_id) = 1),
  constraint order_items_type_matches_reference_check
    check ((item_type = 'PRODUCT') = (product_id is not null)),
  constraint order_items_line_total_check
    check (line_total = quantity * actual_unit_price),
  constraint order_items_tenant_id_id_unique unique (tenant_id, id)
);

create index if not exists order_items_order_idx
  on public.order_items (tenant_id, order_id);

-- ── sales ────────────────────────────────────────────────────────────────────
-- Exactly one sale per order: unique (tenant_id, order_id). A sale is the
-- commercial transaction only — never payment, reconciliation, or ledger.

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null,
  customer_id uuid,
  seller_id uuid,
  status text not null default 'COMPLETED',
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  currency_code char(3) not null default 'KES',
  idempotency_key text,
  approved_at timestamptz,
  approved_by uuid references public.users(id),
  completed_at timestamptz,
  recorded_by uuid references public.users(id),
  voided_at timestamptz,
  voided_by uuid references public.users(id),
  void_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sale_status_check
    check (status in ('PENDING', 'COMPLETED', 'VOIDED')),
  constraint sales_order_fk foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete restrict,
  constraint sales_customer_fk foreign key (tenant_id, customer_id)
    references public.customers (tenant_id, id) on delete restrict,
  constraint sales_seller_fk foreign key (tenant_id, seller_id)
    references public.users (tenant_id, id) on delete restrict,
  constraint sales_tenant_order_unique unique (tenant_id, order_id),
  constraint sales_tenant_id_id_unique unique (tenant_id, id)
);

create unique index if not exists sales_tenant_idempotency_unique_idx
  on public.sales (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists sales_tenant_status_idx
  on public.sales (tenant_id, status, created_at desc);

-- ── sale_items ───────────────────────────────────────────────────────────────

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_id uuid not null,
  item_type text not null check (item_type in ('PRODUCT', 'SERVICE')),
  product_id uuid,
  service_id uuid,
  quantity integer not null check (quantity > 0),
  catalog_unit_price numeric(12, 2) not null check (catalog_unit_price >= 0),
  actual_unit_price numeric(12, 2) not null check (actual_unit_price >= 0),
  line_total numeric(12, 2) not null check (line_total >= 0),
  item_name text not null,
  item_snapshot jsonb not null default '{}'::jsonb,
  commission_type public.commission_type not null default 'percentage',
  commission_value numeric(12, 2) not null default 0 check (commission_value >= 0),
  commission_amount numeric(12, 2) not null default 0 check (commission_amount >= 0),
  override_reason text,
  override_by uuid references public.users(id),
  override_at timestamptz,
  override_history_unknown boolean not null default false,
  created_at timestamptz not null default now(),
  constraint sale_items_sale_fk foreign key (tenant_id, sale_id)
    references public.sales (tenant_id, id) on delete restrict,
  constraint sale_items_product_fk foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete restrict,
  constraint sale_items_service_fk foreign key (tenant_id, service_id)
    references public.services (tenant_id, id) on delete restrict,
  constraint sale_items_single_reference_check
    check (num_nonnulls(product_id, service_id) = 1),
  constraint sale_items_type_matches_reference_check
    check ((item_type = 'PRODUCT') = (product_id is not null)),
  constraint sale_items_line_total_check
    check (line_total = quantity * actual_unit_price),
  constraint sale_items_tenant_id_id_unique unique (tenant_id, id)
);

create index if not exists sale_items_sale_idx
  on public.sale_items (tenant_id, sale_id);

-- ── row-level security ───────────────────────────────────────────────────────
-- Orders/sales are created by anyone who can record commerce (staff included);
-- lifecycle transitions are enforced application-side. Deletes are
-- super-admin only; voids are status changes, never deletes.

alter table public.orders enable row level security;
alter table public.orders force row level security;
alter table public.order_items enable row level security;
alter table public.order_items force row level security;
alter table public.sales enable row level security;
alter table public.sales force row level security;
alter table public.sale_items enable row level security;
alter table public.sale_items force row level security;

drop policy if exists orders_select_policy on public.orders;
create policy orders_select_policy
on public.orders for select using (app.can_access_tenant(tenant_id));

drop policy if exists orders_insert_policy on public.orders;
create policy orders_insert_policy
on public.orders for insert with check (app.can_record_services(tenant_id));

drop policy if exists orders_update_policy on public.orders;
create policy orders_update_policy
on public.orders for update
using (app.can_record_services(tenant_id))
with check (app.can_record_services(tenant_id));

drop policy if exists orders_delete_policy on public.orders;
create policy orders_delete_policy
on public.orders for delete using (app.is_super_admin());

drop policy if exists order_items_select_policy on public.order_items;
create policy order_items_select_policy
on public.order_items for select using (app.can_access_tenant(tenant_id));

drop policy if exists order_items_insert_policy on public.order_items;
create policy order_items_insert_policy
on public.order_items for insert with check (app.can_record_services(tenant_id));

drop policy if exists order_items_update_policy on public.order_items;
create policy order_items_update_policy
on public.order_items for update
using (app.can_record_services(tenant_id))
with check (app.can_record_services(tenant_id));

drop policy if exists order_items_delete_policy on public.order_items;
create policy order_items_delete_policy
on public.order_items for delete using (app.is_super_admin());

drop policy if exists sales_select_policy on public.sales;
create policy sales_select_policy
on public.sales for select using (app.can_access_tenant(tenant_id));

drop policy if exists sales_insert_policy on public.sales;
create policy sales_insert_policy
on public.sales for insert with check (app.can_record_services(tenant_id));

drop policy if exists sales_update_policy on public.sales;
create policy sales_update_policy
on public.sales for update
using (app.can_record_services(tenant_id))
with check (app.can_record_services(tenant_id));

drop policy if exists sales_delete_policy on public.sales;
create policy sales_delete_policy
on public.sales for delete using (app.is_super_admin());

drop policy if exists sale_items_select_policy on public.sale_items;
create policy sale_items_select_policy
on public.sale_items for select using (app.can_access_tenant(tenant_id));

drop policy if exists sale_items_insert_policy on public.sale_items;
create policy sale_items_insert_policy
on public.sale_items for insert with check (app.can_record_services(tenant_id));

drop policy if exists sale_items_update_policy on public.sale_items;
create policy sale_items_update_policy
on public.sale_items for update
using (app.can_record_services(tenant_id))
with check (app.can_record_services(tenant_id));

drop policy if exists sale_items_delete_policy on public.sale_items;
create policy sale_items_delete_policy
on public.sale_items for delete using (app.is_super_admin());

commit;
