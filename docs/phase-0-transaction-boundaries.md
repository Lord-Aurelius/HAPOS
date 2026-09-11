# Phase 0.7 — Transaction Boundary Design

Status: **designed**. Implemented from Phase 1 (no PaymentOS in Phase 0).

## Current boundaries (verified in code)

- All writes go through `updateStore(mutator)` (`src/server/store/index.ts:518`).
- Postgres mode: `BEGIN` → `SELECT state ... FOR UPDATE` → run mutator on the
  whole JSON document → `UPDATE app.runtime_state ... version+1` → `COMMIT`
  (`:528-535`), `ROLLBACK` on throw (`:537-539`).
- File mode: serialised by the single-process `writeChain` (`:397-400`).
- Consequence: **the whole store is the transaction**. Concurrent sellers
  contend on one row; per-entity atomicity does not exist yet.

## Target boundaries (Phase 1+)

### Immediate-posting sale (cash / on-account)

```
BEGIN (postgres row-level transaction)
  INSERT sale (status=confirmed)
  INSERT sale_items (each: catalog_price + actual_sale_price snapshot)
  INSERT inventory_movements (one per product line, kind=sale)
  UPDATE product quantity_on_hand (checked: never negative unless policy allows)
COMMIT
```

All-or-nothing. The `updateStore` whole-document lock is **not** used for this
path; the commerce DAL opens its own transaction per sale.

### M-Pesa flow (PaymentOS authority — never assume success)

```
1. BEGIN
     INSERT sale (status=pending_payment)
     INSERT sale_items
     INSERT payment (status=pending, idempotency_key=sale_id, phone_redacted log)
   COMMIT
2. PaymentOS STK push (outside any DB transaction; retry with same idempotency key)
3. Async callback / verify poll (separate request, separate transaction):
     BEGIN
       UPDATE payment → success|failed (guard: only from pending)
       IF success:
         UPDATE sale → confirmed
         INSERT inventory_movements + UPDATE quantity_on_hand
         (reconciliation + ledger follow in their own Phase 5 transactions)
     COMMIT
```

Rules:

- Stock moves **only** on `payment=success` (or on immediate confirmation for
  cash). `request payment → assume success → reduce stock` is prohibited.
- Callbacks are idempotent: re-delivery of the same PaymentOS receipt finds
  `payment≠pending` and returns the stored outcome without re-posting.
- SMS thank-you and AI events fire **after** commit (outbox pattern in
  Phase 5; synchronous `dispatchSmsLogs` remains acceptable in Phase 1 only
  because the sale commit never depends on it).

### What begins/ends where

| Operation | Transaction scope |
|---|---|
| Direct sale + stock | One DB transaction (sale + items + movements) |
| Payment intent | One DB transaction (sale pending + payment pending) |
| Payment callback | One DB transaction (payment + sale transition + stock) |
| Approval (order→sale) | One DB transaction (order status + sale insert), keeps `already-approved` guard |
| Void/correction | One DB transaction (flag + linked-order restore), never hard-delete |
| Reconciliation / ledger posting | Separate transactions owned by Phase 5, post-on-reconcile only |
| Notifications / AI | Outside all sale transactions (post-commit subscribers) |
