-- HAPOS Phase 4b — tenant commerce policy (additive, idempotent).
--
-- The file projection carries per-tenant commerce policy that the relational
-- schema was missing. Only order_review_required today; future merchant
-- policy (negative-stock rules, discount thresholds) belongs here, never in
-- application code branches.

begin;

alter table public.tenants
  add column if not exists order_review_required boolean not null default true;

commit;
