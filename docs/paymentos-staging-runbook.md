# PaymentOS Staging Runbook — HAPOS M-Pesa Verification (Phase 4B closure)

Operational, step-by-step procedure to verify the HAPOS ↔ PaymentOS merchant
connection against the **staging** PaymentOS deployment. No production money,
no production credentials, ever. Companion to
`docs/paymentos-merchant-connection.md` (the verified contract).

Marking: every checklist item is either executed (record date + initials in
the ☐ line) or remains an open gap in the Phase 4B closure reconciliation.

---

## 0. Preconditions

```
☐ Staging PaymentOS deployment reachable (PAYMENTOS_BASE_URL, SANDBOX)
☐ Staging PostgreSQL database for HAPOS staging (SQL mode, not file mode)
☐ HAPOS staging deployed from this repo, migrations applied:
    db/migrations/phase-04-payments.sql
    db/migrations/phase-4b-payment-connections.sql
    db/migrations/phase-4b2-connection-events.sql
☐ Env on staging HAPOS (server-side only, never committed):
    PAYMENTOS_BASE_URL=<staging PaymentOS URL>
    PAYMENTOS_ENVIRONMENT=SANDBOX
    PAYMENTOS_WRAP_KEY=<64 hex chars>
    APP_ENV=staging (or NODE_ENV != production)
☐ No production keys anywhere: grep the staging env for "live" / prod keys
```

Callback URL: PaymentOS delivers webhooks to the per-tenant webhook URL
configured in the PaymentOS admin console. Point it at
`<staging HAPOS>/api/v1/payments/callback`. It must be publicly reachable
(HTTPS recommended); PaymentOS signs with the tenant's webhook secret
(`t=,v1=` over canonical JSON — HAPOS verifies it).

## 1. Merchant setup (platform side)

```
☐ PaymentOS super admin confirms/creates the staging merchant (tenant)
☐ PaymentOS admin notes the tenant id (merchant id) and environment
☐ M-Pesa payment account exists on the merchant (PAYBILL/TILL, SANDBOX
  environment, configured with sandbox Daraja passkeys)
☐ API key issued for the tenant (shown ONCE — hand to the shop admin
  out-of-band; it is never stored in this runbook)
☐ Webhook signing secret issued + webhook URL registered (shown once)
```

## 2. Connect the HAPOS tenant

```
☐ Log into HAPOS staging as that tenant's shop_admin
☐ Admin → Settings → Payments ("How this shop accepts M-Pesa money")
☐ Enter: merchant id (tenant id), API key, webhook secret, environment
  SANDBOX, optional display name
☐ Connect → expect success banner
    "PaymentOS connected. M-Pesa is live for this shop."
☐ Panel shows: status Connected, merchant identity, environment
  SANDBOX, supported methods MPESA, M-Pesa: CONNECTED
☐ Super admin → /super/payments shows the tenant row with a MASKED
  merchant reference and the CONNECTED audit event
☐ Re-entering the API key is impossible by design (shown once); the
  connection can be verified with "Test connection" at any time
```

## 3. Verify the connection

```
☐ Settings → Payments → "Test connection"
☐ Expect: "Connection verified with PaymentOS." and Last verified
  timestamp refreshes
☐ Audit trail (/super/payments) gains VERIFIED (OK)
```

## 4. Seller setup

```
☐ Seller user created for the tenant; seller QR poster reachable
☐ Seller logs into the seller portal
☐ Catalog has a product/service with stock ≥ 1 and a sensible price
```

## 5. Successful payment (the golden path)

```
Seller scans QR → product → quantity 1 → M-Pesa → customer phone
☐ HAPOS creates the order + a PENDING payment bound to the tenant's
  connection (connection_id + provider merchant reference snapshot)
☐ PaymentOS receives the STK push for the correct merchant/account
☐ Customer phone receives the STK prompt → enter PIN → approve
☐ PaymentOS dispatches payment.completed webhook (signed)
☐ HAPOS callback verifies the signature with the payment's connection
  secret and transitions the payment SUCCESS
☐ Sale finalizes; inventory decrements by the sold quantity
☐ Receipt renders; seller portal and admin Orders/Sales show it
☐ Admin Orders: payment row shows the sale + provider reference
```

## 6. Failure tests (each must produce the stated outcome)

### 6.1 Customer decline
```
☐ Initiate → decline the STK prompt
☐ payment FAILED (provider evidence recorded); NO sale; NO inventory
  movement; seller sees a clear failure message
```

### 6.2 Customer timeout
```
☐ Initiate → ignore the prompt until it expires
☐ payment EXPIRED/FAILED; NO sale; NO inventory movement
```

### 6.3 Duplicate seller submission
```
☐ Re-submit the same order/payment attempt
☐ One payment attempt per idempotency key — no duplicate charge
```

### 6.4 Duplicate callback
```
☐ Replay the same signed webhook to /api/v1/payments/callback
☐ Exactly one SUCCESS transition, one sale, one inventory effect
```

### 6.5 Missed callback (webhook not delivered)
```
☐ Initiate and approve; do NOT let the webhook through (block/absorb it)
☐ After ~2 minutes: admin → Orders → "Check payment status with
  PaymentOS"
☐ Poller hits GET /api/payments/:id/status through the payment's own
  connection → provider PAID → HAPOS SUCCESS → sale finalizes →
  inventory posts
```

### 6.6 Amount mismatch (defensive)
```
☐ Simulate a webhook/poll response whose amount ≠ the HAPOS order total
☐ Payment must NOT finalize; explicit exception/evidence recorded;
  NO false successful sale
```

### 6.7 Insufficient stock (final-stock race)
```
☐ Drive stock to 0, then approve an STK push for that product
☐ Payment SUCCESS but sale finalization fails → needs_recovery flag
☐ Admin recovers from Orders ("Recover sale") → sale + inventory post
```

### 6.8 Disconnected connection
```
☐ Settings → Payments → Disconnect
☐ Audit DISCONNECTED recorded; historical payments/sales/receipts
  remain readable
☐ New M-Pesa attempt → blocked BEFORE any provider call with
  "M-Pesa unavailable for this shop."
```

## 7. Reconnect + rotation

```
☐ Reconnect to the SAME merchant (Reconnect PaymentOS form)
☐ Audit RECONNECTED; same connection row (payments keep the id)
☐ An M-Pesa payment resumes and completes
☐ Rotate credentials: Settings → Payments → "Rotate credentials" with a
  freshly issued key + webhook secret
☐ Expect "New credentials verified and activated"; audit
  CREDENTIAL_ROTATED
☐ Submitting the OLD key again → "already active" no-op (unchanged)
☐ Submitting a WRONG key → rotation fails; old credential stays active;
  audit ROTATION_FAILED (ERROR)
☐ A payment created before rotation still resolves through the same
  connection (historical integrity)
```

## 8. Database verification (staging PostgreSQL)

```
psql "$STAGING_DATABASE_URL"
☐ \d payment_connections          -- RLS enabled, policies present
☐ \d payment_connection_events    -- audit entity exists
☐ SELECT tenant_id, provider_tenant_id, environment, status,
         connected_at, last_verified_at, disconnected_at
  FROM payment_connections;       -- NO secret columns in this query
☐ Confirm the secret columns hold v1.<iv>.<ct> sealed blobs only
☐ Unique active rule: attempt a second CONNECTED row for the same
  tenant + environment → constraint violation expected
```

## 9. Regression gates (on the staging build)

```
☐ npm test            (unit + connection + payment matrices)
☐ npm run lint        (includes typecheck)
☐ npm run build
☐ node scripts/verify-phase-migrations.js
☐ npm run verify:openapi   (if configured; see closure reconciliation)
```

## 10. Tear-down / hygiene

```
☐ Any test customer phone numbers are sandbox-only
☐ No secrets pasted into tickets, this file, or chat logs
☐ Old/rotated keys are revoked in PaymentOS admin
☐ Disconnect the tenant if the staging shop should stay closed
```

---

**Evidence**: attach screenshots/rows for the golden path (§5), one failure
case (§6), the missed-callback convergence (§6.5), the disconnect/reconnect
cycle (§6.8 + §7), and the masked super-admin view (§2) to the closure
reconciliation.
