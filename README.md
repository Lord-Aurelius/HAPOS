# HAPOS

House Aurelius Point of Sale is a cloud-ready, multi-tenant barbershop and salon management SaaS starter for PostgreSQL-backed deployments and local file-backed preview mode.

This repository is organized around the exact outputs requested:

- [`db/schema.sql`](db/schema.sql): PostgreSQL schema, tenant isolation, row-level security, indexes, and reporting views
- [`api/openapi.yaml`](api/openapi.yaml): REST API contract for auth, services, products, customers, finances, subscriptions, reports, and SMS
- [`docs/frontend-structure.md`](docs/frontend-structure.md): frontend route tree, screen layout, and fast-entry UX flow
- [`docs/sms-integration.md`](docs/sms-integration.md): Africa's Talking integration design for automated thank-you messages and manual promotions
- [`src/server/middleware/tenant-context.ts`](src/server/middleware/tenant-context.ts): framework-agnostic tenant/session enforcement helpers
- [`src/server/integrations/africas-talking.ts`](src/server/integrations/africas-talking.ts): lightweight SMS adapter example
- [`src/app`](src/app): Next.js App Router screens and API route handlers
- [`src/server/services`](src/server/services): runtime services shared by the local file store and the Postgres-backed cloud store
- [`db/runtime-store.sql`](db/runtime-store.sql): Postgres runtime-state table used by the cloud deployment path
- [`.env.example`](.env.example): required environment variables

## Architecture

- Backend: stateless REST API behind HTTPS
- Database: PostgreSQL with strict tenant isolation through `tenant_id`
- Tenant model: every shop is a tenant in `tenants`
- Auth model: JWT/session claims must include `user_id`, `tenant_id`, and `role`
- Roles: `super_admin`, `shop_admin`, `staff`
- SMS: Africa's Talking for thank-you messages and manual promotions
- Financial engine: SQL views for daily/monthly income, commissions, and profit/loss

## Multi-Tenant Strategy

Tenant isolation is enforced in two layers:

1. Application layer
   - Every authenticated request resolves a tenant context.
   - Staff and admins only operate inside their assigned shop.
   - Subscription and suspension checks happen before business actions.

2. Database layer
   - All tenant-owned tables include `tenant_id`.
   - Cross-tenant references use composite foreign keys where the business relation matters.
   - Row-Level Security uses `app.user_id`, `app.user_role`, and `app.tenant_id` session settings.
   - `FORCE ROW LEVEL SECURITY` is enabled so accidental broad queries do not leak data.

## Key Business Rules

- Staff can record services and create/update customers during fast entry.
- Only `shop_admin` and `super_admin` can edit the price list.
- Service records can reference predefined services or capture custom off-menu services.
- Commission is stored on each service record as a snapshot so historical reports remain stable.
- Product usage can be recorded against service jobs so monthly reports include product costs and product-usage ranking.
- Net profit uses:
  - Income = `sum(service_records.price)`
  - Expenses = `sum(expenses.amount)`
  - Commission payouts = `sum(commission_payouts.amount)`
  - Product costs = `sum(service_record_products.quantity * service_record_products.unit_cost)`
- Access is blocked when a tenant is suspended or has no active subscription.

## Recommended Cloud Deployment

- App/API: deploy to a managed platform such as Vercel, Render, Fly.io, Railway, AWS ECS, or Cloud Run
- PostgreSQL: use a managed PostgreSQL provider with automated backups and connection pooling
- Background jobs: run thank-you SMS sending in a queue/worker process
- Secrets: store API keys and JWT secrets in the host's secret manager
- TLS: force HTTPS for all traffic

## App Scaffold

The repository now includes a concrete Next.js 16 scaffold with:

- App Router pages for dashboard, service entry, customers, services, commissions, expenses, SMS, subscription, staff management, and super-admin tenant control
- File-backed route handlers under `src/app/api/v1/*` that match the OpenAPI contract
- Typed domain models in [`src/lib/types.ts`](src/lib/types.ts)
- Persistent seeded data for immediate UI rendering in [`src/server/store/seed.ts`](src/server/store/seed.ts)
- Role-based server actions for service entry, expenses, customers, staff, tenants, and subscriptions in [`src/server/actions/hapos.ts`](src/server/actions/hapos.ts)

## Local Run Path

When Node.js is available:

1. Install dependencies with `npm install`
2. Copy [`.env.example`](.env.example) to `.env`
3. Start the app with `npm run dev`
4. Open `http://localhost:3000/login` for the real app or `http://localhost:3000/preview` for the read-only preview route
5. Optional: run the PostgreSQL schema in [`db/schema.sql`](db/schema.sql) when you are ready to swap the local file store for a production database

By default, local development can keep using the persistent JSON snapshot in `data/store.json`. For cloud deployment, set `HAPOS_RUNTIME_MODE=postgres`, point `DATABASE_URL` at your managed Postgres instance, and run `npm run db:bootstrap` once to initialize `app.runtime_state` from the current application data.

If you deploy to Vercel, do not rely on the file-backed runtime for login sessions or writes. Use managed Postgres such as Neon, connect it to the Vercel project, and provide a Postgres connection string through `DATABASE_URL` or the Vercel-provided `POSTGRES_URL` variables before testing login.

## Implementation Notes

- Seeded credentials live on the login screen and in [`src/server/store/seed.ts`](src/server/store/seed.ts).
- Super admin is `platform / aurelius / Aurelius@2026`.
- The production deployment shape still expects PostgreSQL, HTTPS, secure secrets, and Africa's Talking credentials for live SMS delivery.
