# Phase 0.6 — Persistence Architecture Decision

Status: **decided**. Applies from Phase 1 onward. No new tables are created in
Phase 0; the `idempotencyKey` backfill is the only storage change and it rides
the existing JSON migration chain (`migrateStoreState`).

## Current reality (verified)

- Authoritative DDL lives in `db/schema.sql` (11 tables, RLS, reporting views)
  but the runtime does **not** use it per-entity.
- The runtime persists one of:
  - `data/store.json` (file mode: local dev / preview), or
  - `app.runtime_state(id=1, state JSONB)` (postgres mode: cloud), holding the
    **entire** `StoreState` as a single JSON document.
- `prisma/schema.prisma` is a provider-only stub (zero models). There is no
  ORM migration pipeline. Raw `pg` (`src/server/db/*`) is the only DB client.

## Decision

**New commerce entities are first-class PostgreSQL relational tables.
The giant-JSON document is a development-compatibility cache, not the engine.**

Concretely:

| Entity | SQL table (Phase 1+) | JSON compat required? | Migration strategy |
|---|---|---|---|
| products (extended: sku, selling_price, qty, reorder) | `products` ALTER + new columns | Yes (extend `StoreProduct`, migrate defaults) | Additive migration; backfill `selling_price`/`qty` as merchant-input-required (see legacy map) |
| services (extended: BOM consumption) | `services` ALTER + `service_product_links` | Yes (extend `StoreService`) | Additive; empty BOM = current behaviour |
| orders | `orders` CREATE | Transitional read/write shim | Dual-write new orders to SQL + mirror into `customerOrders` until Phase 2 cutover |
| order_items | `order_items` CREATE | Shim only (derive from SQL on read) | SQL-authoritative from day one; JSON mirror is a projection |
| sales | `sales` CREATE | Shim only | Same as orders; `service_records` stays readable, frozen for new writes after cutover |
| sale_items | `sale_items` CREATE | Shim only | Same as order_items |
| inventory_movements | `inventory_movements` CREATE | **No** (SQL-only; JSON exposes derived `quantity_on_hand`) | Opening balances as explicit `OPENING_BALANCE` movements, never fabricated history |
| payments | `payments` CREATE | **No** (SQL-only) | New flows only; no backfill of historical money movement |
| reconciliations | `reconciliations` CREATE | **No** | New flows only |
| ledger_entries | `ledger_entries` CREATE | **No** (derived views stay for reads) | Posted only by the reconciler; backfill one `OPENING` entry per tenant if required |
| seller_credentials | `seller_credentials` CREATE | **No** (never in JSON snapshots) | Secrets/hashes SQL-only; QR payloads carry opaque tokens, never secrets |
| notifications | `sms_logs` EXTEND (+ `notification_events`) | Yes for `sms_logs` (existing) | Extend enum/columns additively |

## Read / write paths

- **Phase 1 target:** server code reads/writes commerce entities through a new
  `src/server/commerce/store/*` data-access layer with two adapters:
  - `postgres` adapter: parameterised SQL per entity (row-level transactions),
  - `file` adapter: the current JSON document (dev/test only).
- The adapter is selected by the existing `getRuntimeBackend()` switch. No
  caller touches `data/store.json` or `app.runtime_state` directly.
- Transitional JSON mirrors are **explicitly marked** (`_transitional: true` in
  code, removal milestone recorded per entity) and deleted at the Phase 2/3
  cutover once parity tests pass.

## Non-goals / prohibitions

- No new nested collections inside the monolithic `StoreState` for commerce
  behaviour (the `idempotencyKey` field is the last such extension).
- No Prisma adoption mid-stream unless a later ADR justifies it; raw SQL keeps
  the RLS/composite-FK design from `db/schema.sql` intact.
- No destructive resets: every migration is additive with backfill defaults.
