create extension if not exists pgcrypto;
create extension if not exists citext;

create schema if not exists app;
create schema if not exists reporting;

do $$
begin
  create type public.user_role as enum ('super_admin', 'shop_admin', 'staff');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.tenant_status as enum ('active', 'suspended', 'inactive');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'expired', 'suspended', 'cancelled');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.commission_type as enum ('fixed', 'percentage');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.sms_kind as enum ('thank_you', 'promotion', 'system');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.sms_status as enum ('queued', 'sent', 'failed');
exception
  when duplicate_object then null;
end $$;

create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function app.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create or replace function app.current_user_role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('app.user_role', true), ''), 'anonymous')
$$;

create or replace function app.is_super_admin()
returns boolean
language sql
stable
as $$
  select (select app.current_user_role()) = 'super_admin'
$$;

create or replace function app.is_shop_admin()
returns boolean
language sql
stable
as $$
  select (select app.current_user_role()) = 'shop_admin'
$$;

create or replace function app.can_access_tenant(target_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select
    (select app.is_super_admin())
    or (
      target_tenant_id is not null
      and target_tenant_id = (select app.current_tenant_id())
    )
$$;

create or replace function app.can_manage_tenant(target_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select
    (select app.is_super_admin())
    or (
      (select app.is_shop_admin())
      and target_tenant_id is not null
      and target_tenant_id = (select app.current_tenant_id())
    )
$$;

create or replace function app.can_record_services(target_tenant_id uuid)
returns boolean
language sql
stable
as $$
  select
    (select app.current_user_role()) in ('super_admin', 'shop_admin', 'staff')
    and (
      (select app.is_super_admin())
      or (
        target_tenant_id is not null
        and target_tenant_id = (select app.current_tenant_id())
      )
    )
$$;

create or replace function app.can_view_service_record(target_tenant_id uuid, target_staff_id uuid)
returns boolean
language sql
stable
as $$
  select
    (select app.can_manage_tenant(target_tenant_id))
    or (
      (select app.current_user_role()) = 'staff'
      and target_tenant_id = (select app.current_tenant_id())
      and target_staff_id = (select app.current_user_id())
    )
$$;

create or replace function app.can_view_commissions(target_tenant_id uuid, target_staff_id uuid)
returns boolean
language sql
stable
as $$
  select
    (select app.can_manage_tenant(target_tenant_id))
    or (
      (select app.current_user_role()) = 'staff'
      and target_tenant_id = (select app.current_tenant_id())
      and target_staff_id = (select app.current_user_id())
    )
$$;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function app.guard_tenant_status_update()
returns trigger
language plpgsql
as $$
begin
  if (
    new.status is distinct from old.status
    or new.suspension_reason is distinct from old.suspension_reason
  ) and not app.is_super_admin() then
    raise exception 'Only super admin can change tenant status or suspension reason.';
  end if;

  return new;
end;
$$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_name text,
  slug text not null unique,
  logo_url text,
  motto text,
  address text,
  store_number text,
  timezone text not null default 'Africa/Nairobi',
  country_code char(2) not null default 'KE',
  currency_code char(3) not null default 'KES',
  status public.tenant_status not null default 'active',
  suspension_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_format_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  role public.user_role not null,
  full_name text not null,
  username text not null,
  email citext not null,
  phone text,
  password_hash text not null,
  is_active boolean not null default true,
  commission_type public.commission_type not null default 'percentage',
  commission_value numeric(12, 2) not null default 0 check (commission_value >= 0),
  commission_notes text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_role_tenant_check check (
    (role = 'super_admin' and tenant_id is null)
    or (role in ('shop_admin', 'staff') and tenant_id is not null)
  ),
  constraint users_tenant_id_id_unique unique (tenant_id, id)
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  phone text not null,
  phone_e164 text not null,
  notes text,
  marketing_opt_in boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_phone_e164_check check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint customers_tenant_phone_unique unique (tenant_id, phone_e164),
  constraint customers_tenant_id_id_unique unique (tenant_id, id)
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  price numeric(12, 2) not null check (price >= 0),
  description text,
  commission_type public.commission_type not null default 'percentage',
  commission_value numeric(12, 2) not null default 0 check (commission_value >= 0),
  duration_minutes integer check (duration_minutes is null or duration_minutes > 0),
  is_active boolean not null default true,
  created_by uuid references public.users(id),
  updated_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_tenant_id_id_unique unique (tenant_id, id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_tenant_id_id_unique unique (tenant_id, id)
);

create table if not exists public.service_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  staff_id uuid not null,
  service_id uuid,
  service_name text not null,
  is_custom_service boolean not null default false,
  price numeric(12, 2) not null check (price >= 0),
  description text,
  commission numeric(12, 2) not null default 0 check (commission >= 0),
  commission_type public.commission_type not null default 'percentage',
  commission_value numeric(12, 2) not null default 0 check (commission_value >= 0),
  performed_at timestamptz not null default now(),
  recorded_by uuid not null references public.users(id),
  corrected_at timestamptz,
  corrected_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint service_records_customer_fk foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  constraint service_records_staff_fk foreign key (tenant_id, staff_id) references public.users (tenant_id, id) on delete restrict,
  constraint service_records_service_fk foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete restrict,
  constraint service_records_tenant_id_id_unique unique (tenant_id, id)
);

create table if not exists public.service_record_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  service_record_id uuid not null,
  product_id uuid not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_cost numeric(12, 2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  constraint service_record_products_service_record_fk foreign key (tenant_id, service_record_id)
    references public.service_records (tenant_id, id) on delete cascade,
  constraint service_record_products_product_fk foreign key (tenant_id, product_id)
    references public.products (tenant_id, id) on delete restrict,
  constraint service_record_products_tenant_id_id_unique unique (tenant_id, id)
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category text not null,
  description text,
  amount numeric(12, 2) not null check (amount >= 0),
  expense_date date not null default current_date,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expenses_tenant_id_id_unique unique (tenant_id, id)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_code text not null,
  status public.subscription_status not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  grace_ends_at timestamptz,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  currency_code char(3) not null default 'KES',
  auto_renew boolean not null default false,
  payment_terms text,
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_period_check check (ends_at > starts_at),
  constraint subscriptions_tenant_id_id_unique unique (tenant_id, id)
);

create table if not exists public.sms_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid,
  created_by uuid references public.users(id),
  sms_type public.sms_kind not null,
  recipient_phone text not null,
  message text not null,
  provider text not null default 'africas_talking',
  provider_message_id text,
  status public.sms_status not null default 'queued',
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sms_logs_phone_check check (recipient_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint sms_logs_customer_fk foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete restrict,
  constraint sms_logs_tenant_id_id_unique unique (tenant_id, id)
);

create table if not exists public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  staff_id uuid not null,
  period_start date not null,
  period_end date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  paid_at timestamptz,
  reference text,
  notes text,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint commission_payouts_period_check check (period_end >= period_start),
  constraint commission_payouts_staff_fk foreign key (tenant_id, staff_id) references public.users (tenant_id, id) on delete restrict,
  constraint commission_payouts_tenant_period_unique unique (tenant_id, staff_id, period_start, period_end),
  constraint commission_payouts_tenant_id_id_unique unique (tenant_id, id)
);

create index if not exists users_tenant_role_idx
  on public.users (tenant_id, role)
  where tenant_id is not null;

create unique index if not exists users_tenant_username_unique_idx
  on public.users (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(username)
  );

create unique index if not exists users_tenant_email_unique_idx
  on public.users (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(email)
  );

create index if not exists customers_tenant_created_idx
  on public.customers (tenant_id, created_at desc);

create index if not exists services_tenant_active_idx
  on public.services (tenant_id, is_active, name);

create index if not exists services_tenant_active_only_idx
  on public.services (tenant_id, name)
  where is_active = true;

create unique index if not exists services_tenant_name_unique_idx
  on public.services (tenant_id, lower(name));

create index if not exists products_tenant_active_idx
  on public.products (tenant_id, is_active, name);

create unique index if not exists products_tenant_name_unique_idx
  on public.products (tenant_id, lower(name));

create index if not exists service_records_tenant_performed_idx
  on public.service_records (tenant_id, performed_at desc);

create index if not exists service_records_tenant_staff_performed_idx
  on public.service_records (tenant_id, staff_id, performed_at desc);

create index if not exists service_records_tenant_customer_performed_idx
  on public.service_records (tenant_id, customer_id, performed_at desc);

create index if not exists service_records_tenant_service_performed_idx
  on public.service_records (tenant_id, service_id, performed_at desc);

create index if not exists service_record_products_tenant_record_idx
  on public.service_record_products (tenant_id, service_record_id);

create index if not exists service_record_products_tenant_product_idx
  on public.service_record_products (tenant_id, product_id);

create index if not exists expenses_tenant_date_idx
  on public.expenses (tenant_id, expense_date desc);

create index if not exists subscriptions_tenant_status_ends_idx
  on public.subscriptions (tenant_id, status, ends_at desc);

create index if not exists subscriptions_current_window_idx
  on public.subscriptions (tenant_id, ends_at desc)
  where status in ('trialing', 'active', 'past_due', 'suspended');

create index if not exists sms_logs_tenant_created_idx
  on public.sms_logs (tenant_id, created_at desc);

create index if not exists sms_logs_tenant_status_idx
  on public.sms_logs (tenant_id, status, created_at desc);

create index if not exists commission_payouts_tenant_staff_period_idx
  on public.commission_payouts (tenant_id, staff_id, period_start desc);

create index if not exists commission_payouts_tenant_paid_idx
  on public.commission_payouts (tenant_id, paid_at desc);

drop trigger if exists tenants_set_updated_at on public.tenants;
create trigger tenants_set_updated_at
before update on public.tenants
for each row
execute function app.touch_updated_at();

drop trigger if exists tenants_guard_status_update on public.tenants;
create trigger tenants_guard_status_update
before update on public.tenants
for each row
execute function app.guard_tenant_status_update();

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row
execute function app.touch_updated_at();

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
before update on public.customers
for each row
execute function app.touch_updated_at();

drop trigger if exists services_set_updated_at on public.services;
create trigger services_set_updated_at
before update on public.services
for each row
execute function app.touch_updated_at();

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row
execute function app.touch_updated_at();

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
before update on public.expenses
for each row
execute function app.touch_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at
before update on public.subscriptions
for each row
execute function app.touch_updated_at();

create or replace function app.tenant_is_active(target_tenant_id uuid, at_time timestamptz default now())
returns boolean
language sql
stable
as $$
  select
    exists (
      select 1
      from public.tenants t
      where t.id = target_tenant_id
        and t.status = 'active'
    )
    and exists (
      select 1
      from public.subscriptions s
      where s.tenant_id = target_tenant_id
        and s.status in ('trialing', 'active', 'past_due')
        and coalesce(s.grace_ends_at, s.ends_at) >= at_time
    )
$$;

alter table public.tenants enable row level security;
alter table public.tenants force row level security;
alter table public.users enable row level security;
alter table public.users force row level security;
alter table public.customers enable row level security;
alter table public.customers force row level security;
alter table public.services enable row level security;
alter table public.services force row level security;
alter table public.products enable row level security;
alter table public.products force row level security;
alter table public.service_records enable row level security;
alter table public.service_records force row level security;
alter table public.service_record_products enable row level security;
alter table public.service_record_products force row level security;
alter table public.expenses enable row level security;
alter table public.expenses force row level security;
alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;
alter table public.sms_logs enable row level security;
alter table public.sms_logs force row level security;
alter table public.commission_payouts enable row level security;
alter table public.commission_payouts force row level security;

drop policy if exists tenants_select_policy on public.tenants;
create policy tenants_select_policy
on public.tenants
for select
using (app.can_access_tenant(id));

drop policy if exists tenants_insert_policy on public.tenants;
create policy tenants_insert_policy
on public.tenants
for insert
with check (app.is_super_admin());

drop policy if exists tenants_update_policy on public.tenants;
create policy tenants_update_policy
on public.tenants
for update
using (app.can_manage_tenant(id))
with check (app.can_manage_tenant(id));

drop policy if exists tenants_delete_policy on public.tenants;
create policy tenants_delete_policy
on public.tenants
for delete
using (app.is_super_admin());

drop policy if exists users_select_policy on public.users;
create policy users_select_policy
on public.users
for select
using (app.can_access_tenant(tenant_id));

drop policy if exists users_insert_policy on public.users;
create policy users_insert_policy
on public.users
for insert
with check (app.can_manage_tenant(tenant_id));

drop policy if exists users_update_policy on public.users;
create policy users_update_policy
on public.users
for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists users_delete_policy on public.users;
create policy users_delete_policy
on public.users
for delete
using (app.can_manage_tenant(tenant_id));

drop policy if exists customers_select_policy on public.customers;
create policy customers_select_policy
on public.customers
for select
using (app.can_access_tenant(tenant_id));

drop policy if exists customers_insert_policy on public.customers;
create policy customers_insert_policy
on public.customers
for insert
with check (app.can_record_services(tenant_id));

drop policy if exists customers_update_policy on public.customers;
create policy customers_update_policy
on public.customers
for update
using (app.can_record_services(tenant_id))
with check (app.can_record_services(tenant_id));

drop policy if exists customers_delete_policy on public.customers;
create policy customers_delete_policy
on public.customers
for delete
using (app.can_manage_tenant(tenant_id));

drop policy if exists services_select_policy on public.services;
create policy services_select_policy
on public.services
for select
using (app.can_access_tenant(tenant_id));

drop policy if exists services_insert_policy on public.services;
create policy services_insert_policy
on public.services
for insert
with check (app.can_manage_tenant(tenant_id));

drop policy if exists services_update_policy on public.services;
create policy services_update_policy
on public.services
for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists services_delete_policy on public.services;
create policy services_delete_policy
on public.services
for delete
using (app.can_manage_tenant(tenant_id));

drop policy if exists products_select_policy on public.products;
create policy products_select_policy
on public.products
for select
using (app.can_access_tenant(tenant_id));

drop policy if exists products_insert_policy on public.products;
create policy products_insert_policy
on public.products
for insert
with check (app.can_manage_tenant(tenant_id));

drop policy if exists products_update_policy on public.products;
create policy products_update_policy
on public.products
for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists products_delete_policy on public.products;
create policy products_delete_policy
on public.products
for delete
using (app.can_manage_tenant(tenant_id));

drop policy if exists service_records_select_policy on public.service_records;
create policy service_records_select_policy
on public.service_records
for select
using (app.can_view_service_record(tenant_id, staff_id));

drop policy if exists service_records_insert_policy on public.service_records;
create policy service_records_insert_policy
on public.service_records
for insert
with check (app.can_record_services(tenant_id));

drop policy if exists service_records_update_policy on public.service_records;
create policy service_records_update_policy
on public.service_records
for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists service_records_delete_policy on public.service_records;
create policy service_records_delete_policy
on public.service_records
for delete
using (app.can_manage_tenant(tenant_id));

drop policy if exists service_record_products_select_policy on public.service_record_products;
create policy service_record_products_select_policy
on public.service_record_products
for select
using (app.can_view_service_record(tenant_id, (select sr.staff_id from public.service_records sr where sr.id = service_record_id)));

drop policy if exists service_record_products_insert_policy on public.service_record_products;
create policy service_record_products_insert_policy
on public.service_record_products
for insert
with check (app.can_record_services(tenant_id));

drop policy if exists service_record_products_update_policy on public.service_record_products;
create policy service_record_products_update_policy
on public.service_record_products
for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists service_record_products_delete_policy on public.service_record_products;
create policy service_record_products_delete_policy
on public.service_record_products
for delete
using (app.can_manage_tenant(tenant_id));

drop policy if exists expenses_select_policy on public.expenses;
create policy expenses_select_policy
on public.expenses
for select
using (app.can_manage_tenant(tenant_id));

drop policy if exists expenses_insert_policy on public.expenses;
create policy expenses_insert_policy
on public.expenses
for insert
with check (app.can_manage_tenant(tenant_id));

drop policy if exists expenses_update_policy on public.expenses;
create policy expenses_update_policy
on public.expenses
for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists expenses_delete_policy on public.expenses;
create policy expenses_delete_policy
on public.expenses
for delete
using (app.can_manage_tenant(tenant_id));

drop policy if exists subscriptions_select_policy on public.subscriptions;
create policy subscriptions_select_policy
on public.subscriptions
for select
using (app.can_manage_tenant(tenant_id));

drop policy if exists subscriptions_insert_policy on public.subscriptions;
create policy subscriptions_insert_policy
on public.subscriptions
for insert
with check (app.is_super_admin());

drop policy if exists subscriptions_update_policy on public.subscriptions;
create policy subscriptions_update_policy
on public.subscriptions
for update
using (app.is_super_admin())
with check (app.is_super_admin());

drop policy if exists subscriptions_delete_policy on public.subscriptions;
create policy subscriptions_delete_policy
on public.subscriptions
for delete
using (app.is_super_admin());

drop policy if exists sms_logs_select_policy on public.sms_logs;
create policy sms_logs_select_policy
on public.sms_logs
for select
using (app.can_manage_tenant(tenant_id));

drop policy if exists sms_logs_insert_policy on public.sms_logs;
create policy sms_logs_insert_policy
on public.sms_logs
for insert
with check (app.can_record_services(tenant_id));

drop policy if exists sms_logs_update_policy on public.sms_logs;
create policy sms_logs_update_policy
on public.sms_logs
for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists commission_payouts_select_policy on public.commission_payouts;
create policy commission_payouts_select_policy
on public.commission_payouts
for select
using (app.can_view_commissions(tenant_id, staff_id));

drop policy if exists commission_payouts_insert_policy on public.commission_payouts;
create policy commission_payouts_insert_policy
on public.commission_payouts
for insert
with check (app.can_manage_tenant(tenant_id));

drop policy if exists commission_payouts_update_policy on public.commission_payouts;
create policy commission_payouts_update_policy
on public.commission_payouts
for update
using (app.can_manage_tenant(tenant_id))
with check (app.can_manage_tenant(tenant_id));

drop policy if exists commission_payouts_delete_policy on public.commission_payouts;
create policy commission_payouts_delete_policy
on public.commission_payouts
for delete
using (app.can_manage_tenant(tenant_id));

create or replace view reporting.customer_visit_history as
select
  c.tenant_id,
  c.id as customer_id,
  c.name,
  c.phone,
  c.phone_e164,
  count(sr.id) as total_visits,
  coalesce(sum(sr.price), 0)::numeric(12, 2) as lifetime_value,
  max(sr.performed_at) as last_visit_at
from public.customers c
left join public.service_records sr
  on sr.tenant_id = c.tenant_id
 and sr.customer_id = c.id
group by c.tenant_id, c.id, c.name, c.phone, c.phone_e164;

create or replace view reporting.daily_income as
select
  tenant_id,
  performed_at::date as business_date,
  count(*) as total_services,
  sum(price)::numeric(12, 2) as income
from public.service_records
group by tenant_id, performed_at::date;

create or replace view reporting.monthly_income as
select
  tenant_id,
  date_trunc('month', performed_at)::date as month_start,
  count(*) as total_services,
  sum(price)::numeric(12, 2) as income
from public.service_records
group by tenant_id, date_trunc('month', performed_at)::date;

create or replace view reporting.staff_monthly_performance as
select
  sr.tenant_id,
  date_trunc('month', sr.performed_at)::date as month_start,
  sr.staff_id,
  u.full_name as staff_name,
  count(*) as total_services,
  count(distinct sr.customer_id) as client_count,
  sum(sr.price)::numeric(12, 2) as total_revenue,
  sum(sr.commission)::numeric(12, 2) as total_commission
from public.service_records sr
join public.users u
  on u.id = sr.staff_id
group by sr.tenant_id, date_trunc('month', sr.performed_at)::date, sr.staff_id, u.full_name;

create or replace view reporting.daily_profit_loss as
with activity_days as (
  select tenant_id, performed_at::date as business_date
  from public.service_records
  union
  select tenant_id, expense_date as business_date
  from public.expenses
  union
  select tenant_id, paid_at::date as business_date
  from public.commission_payouts
  where paid_at is not null
),
income as (
  select
    tenant_id,
    performed_at::date as business_date,
    sum(price)::numeric(12, 2) as income
  from public.service_records
  group by tenant_id, performed_at::date
),
expenses as (
  select
    tenant_id,
    expense_date as business_date,
    sum(amount)::numeric(12, 2) as expenses
  from public.expenses
  group by tenant_id, expense_date
),
commission_payouts as (
  select
    tenant_id,
    paid_at::date as business_date,
    sum(amount)::numeric(12, 2) as commissions_paid
  from public.commission_payouts
  where paid_at is not null
  group by tenant_id, paid_at::date
),
product_costs as (
  select
    srp.tenant_id,
    sr.performed_at::date as business_date,
    sum(srp.quantity * srp.unit_cost)::numeric(12, 2) as product_costs
  from public.service_record_products srp
  join public.service_records sr
    on sr.tenant_id = srp.tenant_id
   and sr.id = srp.service_record_id
  group by srp.tenant_id, sr.performed_at::date
)
select
  d.tenant_id,
  d.business_date,
  coalesce(i.income, 0)::numeric(12, 2) as income,
  coalesce(e.expenses, 0)::numeric(12, 2) as expenses,
  coalesce(cp.commissions_paid, 0)::numeric(12, 2) as commissions_paid,
  coalesce(pc.product_costs, 0)::numeric(12, 2) as product_costs,
  (
    coalesce(i.income, 0)
    - coalesce(e.expenses, 0)
    - coalesce(cp.commissions_paid, 0)
    - coalesce(pc.product_costs, 0)
  )::numeric(12, 2) as net_profit
from activity_days d
left join income i
  on i.tenant_id = d.tenant_id
 and i.business_date = d.business_date
left join expenses e
  on e.tenant_id = d.tenant_id
 and e.business_date = d.business_date
left join commission_payouts cp
  on cp.tenant_id = d.tenant_id
 and cp.business_date = d.business_date
left join product_costs pc
  on pc.tenant_id = d.tenant_id
 and pc.business_date = d.business_date;

create or replace view reporting.monthly_profit_loss as
with months as (
  select distinct tenant_id, date_trunc('month', business_date)::date as month_start
  from reporting.daily_profit_loss
)
select
  m.tenant_id,
  m.month_start,
  coalesce(sum(dpl.income), 0)::numeric(12, 2) as income,
  coalesce(sum(dpl.expenses), 0)::numeric(12, 2) as expenses,
  coalesce(sum(dpl.commissions_paid), 0)::numeric(12, 2) as commissions_paid,
  coalesce(sum(dpl.product_costs), 0)::numeric(12, 2) as product_costs,
  coalesce(sum(dpl.net_profit), 0)::numeric(12, 2) as net_profit
from months m
join reporting.daily_profit_loss dpl
  on dpl.tenant_id = m.tenant_id
 and date_trunc('month', dpl.business_date)::date = m.month_start
group by m.tenant_id, m.month_start;

create or replace view reporting.dashboard_summary_current_month as
with current_month_income as (
  select
    tenant_id,
    sum(price)::numeric(12, 2) as month_revenue
  from public.service_records
  where date_trunc('month', performed_at) = date_trunc('month', now())
  group by tenant_id
),
today_income as (
  select
    tenant_id,
    sum(price)::numeric(12, 2) as today_revenue
  from public.service_records
  where performed_at::date = current_date
  group by tenant_id
),
month_expenses as (
  select
    tenant_id,
    sum(amount)::numeric(12, 2) as month_expenses
  from public.expenses
  where date_trunc('month', expense_date) = date_trunc('month', current_date)
  group by tenant_id
),
month_commission_accrual as (
  select
    tenant_id,
    sum(commission)::numeric(12, 2) as month_commission_accrued
  from public.service_records
  where date_trunc('month', performed_at) = date_trunc('month', now())
  group by tenant_id
),
month_commission_paid as (
  select
    tenant_id,
    sum(amount)::numeric(12, 2) as month_commission_paid
  from public.commission_payouts
  where paid_at is not null
    and date_trunc('month', paid_at) = date_trunc('month', now())
  group by tenant_id
),
month_product_costs as (
  select
    srp.tenant_id,
    sum(srp.quantity * srp.unit_cost)::numeric(12, 2) as month_product_costs
  from public.service_record_products srp
  join public.service_records sr
    on sr.tenant_id = srp.tenant_id
   and sr.id = srp.service_record_id
  where date_trunc('month', sr.performed_at) = date_trunc('month', now())
  group by srp.tenant_id
)
select
  t.id as tenant_id,
  coalesce(ti.today_revenue, 0)::numeric(12, 2) as today_revenue,
  coalesce(mi.month_revenue, 0)::numeric(12, 2) as month_revenue,
  coalesce(me.month_expenses, 0)::numeric(12, 2) as month_expenses,
  coalesce(mca.month_commission_accrued, 0)::numeric(12, 2) as month_commission_accrued,
  coalesce(mcp.month_commission_paid, 0)::numeric(12, 2) as month_commission_paid,
  coalesce(mpc.month_product_costs, 0)::numeric(12, 2) as month_product_costs,
  (
    coalesce(mi.month_revenue, 0)
    - coalesce(me.month_expenses, 0)
    - coalesce(mcp.month_commission_paid, 0)
    - coalesce(mpc.month_product_costs, 0)
  )::numeric(12, 2) as month_net_profit
from public.tenants t
left join today_income ti on ti.tenant_id = t.id
left join current_month_income mi on mi.tenant_id = t.id
left join month_expenses me on me.tenant_id = t.id
left join month_commission_accrual mca on mca.tenant_id = t.id
left join month_commission_paid mcp on mcp.tenant_id = t.id
left join month_product_costs mpc on mpc.tenant_id = t.id;
