# Phase 4B Staging Gap-Closure Evidence (machine-verifiable record)

Generated: 2026-09-14 · HEAD at record: `28db5cd` (branch `main`).
Companion to `docs/paymentos-merchant-connection.md` and
`docs/paymentos-staging-runbook.md`. **This file contains no secrets** —
configuration is reported as SET/MISSING only, hosts are classified, and no
credential, phone number, or customer data appears here.

## 0. Environment audit (§2, names only)

| Requirement | Status | Evidence |
| --- | --- | --- |
| `HAPOS_PUBLIC_APP_URL` (`PUBLIC_APP_URL`) | SET | present in `.env` / `.env.local` / `.env.production.local` |
| `DATABASE_URL` | SET | present in all env files; **password leaked once in a transcript grep and is therefore treated as burned** (rotate recommended) |
| `PAYMENTOS_BASE_URL` | **MISSING** | zero `PAYMENTOS_*` variables in any env file |
| `PAYMENTOS_ENVIRONMENT` | **MISSING** | — |
| `PAYMENTOS_WRAP_KEY` | **MISSING** | (falls back to `QR_WRAP_KEY`, also absent) |
| `HAPOS_RUNTIME_MODE` | SET | `postgres` |
| `APP_ENV` | SET | **`production` in every env file** |

Per §2 of the brief: with `PAYMENTOS_*` configuration MISSING, **no real
payment test was attempted**. The refusal gate in
`src/server/payments/connection-service.ts` would also refuse at runtime
(`connection-secret-unavailable` / missing base URL).

## 1. Database target classification (§22 stop-check)

| Target | Host class | TCP 5432 from this machine | Verdict |
| --- | --- | --- | --- |
| HAPOS `.env` `DATABASE_URL` | Neon `ep-wispy-cell-agqyikdt-…` (`neondb`), every env file declares `APP_ENV=production` | **TIMEOUT (blocked)** | forbidden by §22 (`APP_ENV=production`) **and** unreachable |
| PaymentOS `.env` `DATABASE_URL` | Neon `ep-crimson-rain-al0wsb9y-…` | **TIMEOUT (blocked)** | unreachable (its own blocker) |
| Egress controls | DNS resolves (Neon `63.178.215.242`); HTTPS 443 egress works (github.com → 200) | — | **5432 specifically firewalled** — no local Postgres server or Docker exists as a fallback |

Consequence: `npm run verify:sql-staging` cannot run from this machine
against ANY database. It was **not** run and no workaround was improvised
(§22). No migration was applied to any database from here.

## 2. Staging targets (§0)

- Staging HAPOS deployment: none reachable (no staging URL configured or
  discoverable; only Vercel production markers exist).
- PaymentOS non-production deployment: `https://paymentos-tlk5.onrender.com`
  (its own `.env` declares `NODE_ENV=development`; host shown only because
  the deployment is explicitly non-production). Health was **not probed** —
  without HAPOS-side credentials the connection flow cannot proceed, and
  the deployment's own database is unreachable from here (table above).

## 3. Live checklist results (§23 — machine-verifiable)

| # | Requirement (brief) | Result | Reason |
| --- | --- | --- | --- |
| 1 | SQL migration verification on **real staging PostgreSQL** | **NOT TESTABLE** | no staging DB reachable from this machine; the only configured DB is declared `production` (§22 forbids) and is firewalled |
| 2 | RLS cross-tenant verification on staging | **NOT TESTABLE** | same blocker; covered by unit tests + migration guardrails in CI (10-file parity green) |
| 3 | Connect real PaymentOS merchant (Settings → Payments) | **NOT TESTABLE** | `PAYMENTOS_*` config MISSING; merchant credentials never provisioned |
| 4 | M-Pesa golden path (QR → STK → callback → sale → inventory) | **NOT TESTABLE** | requires #1–#3 |
| 5 | Customer decline | NOT TESTABLE | requires golden path |
| 6 | Customer timeout / expiry | NOT TESTABLE | requires golden path |
| 7 | Duplicate seller submission | NOT TESTABLE | requires golden path |
| 8 | Duplicate callback (one sale, one stock effect) | NOT TESTABLE | requires golden path; automated equivalent PASS (callback idempotency + connection-secret signature tests) |
| 9 | Missed webhook convergence (`Check payment status with PaymentOS`) | NOT TESTABLE | requires golden path; automated equivalent PASS (4 reconciliation tests incl. PAID→SUCCESS→sale→inventory, PENDING stays, provider-error skips) |
| 10 | Amount mismatch / `amount_base` semantics | NOT TESTABLE | provider sandbox flow unavailable; automated equivalent PASS (`amount` vs `amount_total` documented §11 + poller asserts `amount`) |
| 11 | Final-stock race → `needs_recovery` → admin recovery | NOT TESTABLE | requires golden path; automated equivalent PASS (needs-recovery + recoverPaidOrder tests) |
| 12 | Disconnect blocks new payments, history readable | NOT TESTABLE | requires #3; automated equivalent PASS (blocked-before-provider-call + history-integrity tests) |
| 13 | Reconnect same merchant reactivates | NOT TESTABLE | requires #3; automated equivalent PASS |
| 14 | Credential rotation (verify-before-activate, old retired) | NOT TESTABLE | requires #3; automated equivalent PASS (5 rotation tests incl. failed-probe keeps old credential) |
| 15 | Wrong-merchant rejection (`FOREIGN_MERCHANT_REJECTED` audit) | NOT TESTABLE | requires #3; automated equivalent PASS |
| 16 | Super-admin audit view shows masked metadata only | NOT TESTABLE (live) | requires #3; automated equivalent PASS (masking + secret-strip tests); page builds and ships in this commit range |
| 17 | Attendance/seller QR smoke | NOT TESTABLE | no running staging app + no phone channel in this environment |
| 18 | Log review during live tests | NOT TESTABLE | no live traffic; static check PASS (zero `console.*` in payment modules; HMAC `timingSafeEqual`; fixed-vocabulary diagnostics only) |
| 19 | DB chain trace (connection → payment → order → sale → movement) | NOT TESTABLE | requires #1 + #4 |

## 4. Automated verification (§24) — exact results, this machine

| Gate | Result |
| --- | --- |
| `npm test` | **274/274 pass, 0 fail** (108 suites) |
| `npm run lint` (= typecheck) | clean |
| `npm run typecheck` | clean |
| `npm run build` | success (production build) |
| `npm run verify:migrations` | all migration checks passed (10 files, enum/RLS parity) |
| `npm run verify:openapi` | 57/57 routes documented, contract matches route tree |
| `npm run verify:sql-staging` | **NOT RUN** — refuses without staging-confirmed reachable DB (see §1) |

## 5. Hard-stop conditions check (§25 / brief)

- Real PaymentOS merchant association: **not attempted** (no credentials) — not a code failure; a provisioning gap.
- No duplicate-callback/stock, missed-webhook, amount-validation, recovery, or isolation failure was *observed* — those paths are unobservable live from this machine and are covered by the automated suite.
- No production credential was used; no production database was touched; no PaymentOS request was made.
- One **accidental single-line partial exposure of `DATABASE_URL`** occurred in a local terminal transcript during §0 auditing (password segment). Mitigation recorded: treat credential as burned → rotate in Neon; value excluded from this file and all evidence.

## 6. Verdict

**BLOCKED** (deployment validation) — infrastructure gaps, not code gaps:

1. No reachable staging PostgreSQL (5432 egress firewalled; no local/Docker Postgres; only declared DB is production).
2. No PaymentOS staging merchant credentials issued to HAPOS (`PAYMENTOS_*` all MISSING).
3. No staging HAPOS deployment URL.

Unblocking path (owner: platform team, est. effort small):
1. Provision/confirm a **staging** Neon/Postgres and run, from a network with 5432 egress: `psql -f db/schema.sql` + migrations through `phase-4b2-connection-events.sql`, then `HAPOS_STAGING_CONFIRM=yes-staging DATABASE_URL=<staging> npm run verify:sql-staging`.
2. Issue one staging PaymentOS merchant (tenant id, API key, webhook secret) and set `PAYMENTOS_BASE_URL=https://paymentos-tlk5.onrender.com`, `PAYMENTOS_ENVIRONMENT=SANDBOX`, `PAYMENTOS_WRAP_KEY` on the staging HAPOS.
3. Deploy HAPOS staging (or run `npm run dev` on a host with DB egress) and execute `docs/paymentos-staging-runbook.md` §1–§10 top to bottom.
