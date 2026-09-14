# PaymentOS Merchant Connection — Verified Integration Contract (Phase 4B)

Status: **VERIFIED against the attached PaymentOS source** (`House Aurelius/PaymentOS`,
package `@house-aurelius/paymentos@1.0.0`, multi-tenant M-Pesa Daraja STK Push
gateway). Every claim below cites the PaymentOS file it was verified in. Items
that could not be verified from source are explicitly marked `ASSUMED` or
`NOT YET AVAILABLE` and must not silently become production architecture.

## 1. Account model — VERIFIED

PaymentOS is itself multi-tenant. A "PaymentOS merchant" is a **PaymentOS
tenant** identified by a caller-chosen `tenant_id` string (Prisma
`tenants.id`, e.g. `school-a`). PaymentOS routes every payment by
`tenant_id`.

The merchant's *receiving destination* is a **PaymentAccount** owned by that
PaymentOS tenant (`payment_accounts` table): `PAYBILL`, `BUY_GOODS` (Till),
`POCHI_LA_BIASHARA`, or `SEND_MONEY` (currently unsupported for STK), each
with `shortcode`, encrypted passkey, and `environment` (`sandbox|production`).
One PaymentOS tenant can own several payment accounts.

Account/association mechanism verdict (per Phase 4B audit menu):

- **A. OAuth/account linking — NOT AVAILABLE** for consuming apps. Portal
  login exists only for PaymentOS-internal admins/tenants.
- **B. Merchant credentials per account — PARTIAL:** the Daraja consumer
  key/secret are **platform-global** (`DARAJA_CONSUMER_KEY/SECRET` in env,
  `src/config/env.ts`); the shortcode **passkey is per payment account**
  (encrypted at rest).
- **C. Platform-managed submerchant accounts — VERIFIED:** PaymentOS tenants
  are onboarded by the PaymentOS super admin via the admin console/API
  (`POST /api/admin/tenants`, `x-admin-token`), which generates the tenant's
  API key and webhook secret (shown once). Tenant payment accounts are
  self-service thereafter via the portal or the API.
- **D. Merchant ID + API credentials — VERIFIED (this is HAPOS's mechanism):**
  HAPOS authenticates as a PaymentOS tenant with `x-api-key` + `tenant_id`.

## 2. Authentication — VERIFIED

(`src/http/middleware/authenticateTenant.ts`)

- Every HAPOS→PaymentOS request carries `x-api-key: <tenant api key>`.
- `tenant_id` is provided in the JSON body (POST) or query (GET) and **must
  match the API key's tenant**; mismatch is HTTP 403 `FORBIDDEN`.
- API keys are stored server-side only as SHA-256 hashes; PaymentOS never
  returns them. Raw keys are shown **once** at creation in the PaymentOS
  admin console.

## 3. Payment initiation — VERIFIED

`POST /api/payments` (alias `POST /api/pay`), headers `x-api-key`,
`idempotency-key` (optional):

```json
{
  "tenant_id": "<PaymentOS tenant id>",
  "invoice_id": "<HAPOS reference, unique per tenant>",
  "payment_account_id": "optional; default = tenant's active account",
  "account_reference": "≤64 chars; PAYBILL only",
  "phone": "0712345678",
  "amount": 1500,
  "currency": "KES",
  "description": "optional, ≤120 chars",
  "idempotency_key": "≥8 chars"
}
```

Rules verified in `src/http/routes/payments.ts` and
`src/services/paymentService.ts`:

- `amount` is **integer KES base units** and positive (zod
  `z.number().int().positive()`). HAPOS must round to whole KES.
- Idempotency: same `idempotency_key` (header/body) or same
  `(tenant_id, invoice_id)` on an open payment **replays the existing
  payment** without a second STK push.
- Status endpoint: `GET /api/payments/:paymentId/status` (and `/api/payments/
  :paymentId`) — tenant-scoped; other tenants' payments read as 404.
- Amount composition: PaymentOS stores `amount_base` (HAPOS's amount),
  adds `platform_fee` (default KSh 10) and sends `amount_total` to M-Pesa.
  The webhook `amount` field is `amount_base` — i.e. the exact HAPOS order
  total, so HAPOS's amount assertion holds without fee arithmetic.

## 4. Webhooks to HAPOS — VERIFIED

(`src/services/webhookDispatcher.ts`, `src/security/webhookSignature.ts`,
`examples/external-app-node.ts`)

- PaymentOS POSTs to the tenant's configured `webhook_url` on terminal
  outcomes with a generic event: `payment.completed`, `payment.failed`,
  `payment.cancelled`, `payment.expired` (plus a legacy compat block).
- Signature header `x-paymentos-signature: t=<unix>,v1=<hex hmac-sha256>`
  computed over `"<t>.<canonical json body>"` (recursively key-sorted JSON)
  with the tenant's webhook secret. Verifier enforces ±300 s tolerance.
- Delivery headers include `x-paymentos-event` and
  `x-paymentos-delivery-id` (`<paymentId>:<event>:<occurredAt>`).
- Payload fields HAPOS consumes:

```
event             "payment.completed" etc.          VERIFIED
paymentId         PaymentOS payment id              VERIFIED
applicationId     PaymentOS tenant id               VERIFIED
paymentAccountId  destination account id            VERIFIED
amount            amount_base (excl. platform fee)  VERIFIED
currency          "KES"                             VERIFIED
reference         account_reference ?? invoice_id   VERIFIED
providerReceipt   M-Pesa receipt                    VERIFIED
status            legacy status ("paid"|"failed")   VERIFIED
invoice_id        HAPOS-provided reference          VERIFIED
```

- **Tenant resolution:** PaymentOS dispatches only to the *owning* tenant's
  webhook URL and signs with that tenant's secret, but the callback body
  itself names `applicationId` (the PaymentOS tenant id). HAPOS must **not**
  trust any tenant identity in the body: it resolves the HAPOS tenant via
  its own payment record (correlated by `invoice_id` → HAPOS idempotency
  key / `pid`), then verifies the signature with **that payment's
  connection's** webhook secret. The signature then cryptographically
  binds the payload to the PaymentOS tenant.

## 5. Connection health — VERIFIED

`GET /api/payment-accounts` with `x-api-key` + `tenant_id` (query):
authenticated → `200 { payment_accounts: [...] }`; wrong key → 401. The
response carries only non-secret account fields (`display_name`,
`account_type`, `shortcode`, `environment`, `status`) — passkeys never leave
PaymentOS (`paymentAccountService.toPublic`). This single call verifies
**key validity + tenant identity + M-Pesa destination configuration**, so it
is the connection-test primitive. Deeper diagnostics:
`POST /api/payment-accounts/:id/test` returns booleans
(`configured/authenticated/supported/ready`), and
`GET /api/providers/daraja/health` reports platform Daraja auth (`{ provider,
environment, authenticated }`) — booleans only, never secrets.

## 6. Tenant mapping — HAPOS model

```
HAPOS tenant (uuid)
  ↓ 1:1 active per environment
payment_connections row
  ↓ stores
PaymentOS tenant_id  (provider_tenant_id)   — merchant identity
PaymentOS API key    (encrypted, server-side only)
PaymentOS webhook secret (encrypted, server-side only)
```

- Onboarding handoff (mechanism C, self-service is NOT faked): the HAPOS
  shop admin requests a PaymentOS tenant from the platform; the PaymentOS
  super admin creates it and hands over the API key + webhook secret
  (shown once). The shop admin then pastes those into
  Admin → Settings → Payments; HAPOS validates via
  `GET /api/payment-accounts` before marking CONNECTED.
- Credential rotation (VERIFIED: PaymentOS admin console can regenerate
  tenant API keys/secrets): HAPOS store the new secret via reconnect
  (same `provider_tenant_id` → existing row is updated, history preserved).

## 7. Credential storage in HAPOS — VERIFIED design

- The verified contract needs **no merchant-supplied Daraja credentials**:
  consumer key/secret are platform-global inside PaymentOS; passkeys live
  only inside PaymentOS. HAPOS therefore stores only **its own tenant API
  key and webhook secret**, both server-side secrets of the same trust
  class as `JWT_SECRET`/`QR_WRAP_KEY`.
- Storage: AES-256-GCM sealed (`v1.<iv>.<ciphertext+tag>`) using
  `PAYMENTOS_WRAP_KEY` (64 hex chars; falls back to `QR_WRAP_KEY` when
  unset so one key ceremony covers both). Keys are 32 bytes; plaintext is
  never logged, never returned to any client, never stored in the browser.
- Environment separation: the connection stores
  `environment` (`SANDBOX|PRODUCTION`) and it must match the PaymentOS
  deployment's actual environment (`GET /api/payment-accounts` returns each
  account's environment; a SANDBOX connection can never be marked CONNECTED
  against a production PaymentOS account set and vice versa).

## 8. Lifecycle — VERIFIED mapping

```
NOT_CONNECTED  no row / disconnected row only
CONNECTING     credentials submitted, health check in flight
CONNECTED      health check passed; one active connection per tenant
               per environment (DB-enforced)
ERROR          last health check failed (non-sensitive code only)
DISCONNECTED   admin disconnected; historical payments untouched
```

Only CONNECTED connections may initiate M-Pesa. Populated fields never
imply health — `last_verified_at` is set only by an explicit verified
health check.

## 9. What HAPOS does NOT rely on

- No OAuth flow, no redirect-based account linking (does not exist).
- No `PAYMENTOS_MERCHANT_ID` global env var: PaymentOS has no such concept;
  merchant identity is the per-connection `provider_tenant_id`.
- No per-merchant Daraja credential entry: PaymentOS owns those.
- No trust of `applicationId`/`tenant_id` fields inside inbound webhooks
  beyond what the verified signature proves.

## 10. Staging / production setup

Staging (no real money):
1. PaymentOS super admin creates the staging PaymentOS tenant (sandbox
   payment account with the Daraja test paybill/till + passkey).
2. Configure HAPOS staging with the tenant's API key + webhook secret and
   set the connection environment to SANDBOX.
3. Point the PaymentOS tenant's `webhook_url` at
   `https://<hapos-host>/api/v1/payments/callback`.

Production: identical, but the PaymentOS tenant's payment account must be a
production shortcode, HAPOS connection environment must be PRODUCTION, and
`PUBLIC_BASE_URL` (PaymentOS) must be HTTPS so Safaricom reaches its
callback. Rehearse rotation: regenerate the tenant API key in PaymentOS,
reconnect from the HAPOS admin, confirm old key stops authenticating
(staging only).

## 11. Residual gaps / NOT YET AVAILABLE

- PaymentOS supports only `KES` and integer base units (`SUPPORTED_CURRENCIES`)
  — HAPOS already defaults to KES; non-KES tenants cannot use M-Pesa.
- No reverse/refund API in PaymentOS; refunds remain out of scope (Phase 4
  doc already notes this).
- Webhook delivery from PaymentOS is fire-and-forget (retries require their
  reconciliation cron); HAPOS also polls `GET /api/payments/:id/status` on
  callback misses? — NOT YET AVAILABLE in HAPOS (future hardening).
- The exact staging PaymentOS deployment URL + real credentials are
  environment configuration, not code; staging verification (§25 of the
  phase brief) must be run with the platform team.
