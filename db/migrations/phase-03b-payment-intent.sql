-- HAPOS Phase 3b — payment intent columns (additive, idempotent).
--
-- UI reconciliation follow-up: the seller QR records a payment method
-- (CASH | MPESA) plus the validated M-Pesa destination in E.164. M-Pesa
-- orders are HELD for Phase 4 payment — no STK, callback, or success state
-- exists. These columns carry the input boundary only; the Phase 4 payment
-- entity stays separate from sales.
--
-- Apply AFTER phase-03-seller-credentials.sql, inside a transaction, against
-- a development or staging database only.

begin;

alter table public.orders
  add column if not exists payment_method text,
  add column if not exists customer_phone text;

alter table public.sales
  add column if not exists payment_method text,
  add column if not exists customer_phone text;

do $$
begin
  alter table public.orders
    add constraint orders_payment_method_check
    check (payment_method is null or payment_method in ('CASH', 'MPESA'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.sales
    add constraint sales_payment_method_check
    check (payment_method is null or payment_method in ('CASH', 'MPESA'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.orders
    add constraint orders_customer_phone_check
    check (customer_phone is null or customer_phone ~ '^\+[1-9][0-9]{7,14}$');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.sales
    add constraint sales_customer_phone_check
    check (customer_phone is null or customer_phone ~ '^\+[1-9][0-9]{7,14}$');
exception
  when duplicate_object then null;
end $$;

commit;
