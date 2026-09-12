# Phase 2 correction propagation audit (closure GAP 7)

Question: can a legacy service correction corrupt stock or seller-relevant
financial results before Phase 3?

## Trace (verified in code)

`updateServiceRecordAction` (`src/server/actions/hapos.ts`) mutates the
`service_records` row in place: customer, staff, service ref/name, price,
description, commission snapshot, product usages, performedAt, plus
`correctedAt/correctedBy`. It touches NOTHING else.

What stays frozen on a co-written sale (`service_record.commerceSaleId`):

| Engine artifact | Stale after correction? | Effect |
|---|---|---|
| `sales` subtotal/total | Yes (original) | Orders panel + `GET /sales` show original totals |
| `sale_items` prices/commission | Yes (original) | Engine commission view differs from legacy reports |
| `inventory_movements` (SALE / SERVICE_CONSUMPTION) | Yes (original posting stands) | Stock reflects the approved sale, not the correction |
| legacy readers (receipts, history, reports, commissions, exports, AI) | No (they read `service_records`) | Show corrected values |

So a correction creates a bounded display divergence between the Sales
Ledger family (corrected) and the Orders panel family (original). Stock
itself is never moved by the correction path in either system.

## Impact on Phase 3 seller transactions

None on integrity:

1. Seller checkout reads live catalog prices and current
   `quantity_on_hand` — never corrected history.
2. Seller sales create NEW order/sale/movement rows — never mutate the
   corrected row or its frozen engine twin.
3. No path exists from `updateServiceRecordAction` to `inventory_movements`
   (verified: the mutator writes no movements), so a correction cannot
   fabricate, erase, or double-count stock.

The only Phase 3-visible effect is the pre-existing display divergence
above, which Phase 3 does not widen (seller receipts will read engine
sales, matching engine stock).

## Remediation: deferred with cause

- Blocking corrections on co-written records would break the salon
  regression guarantee. Rejected.
- Blind compensating postings (auto-reverse/repost on every correction)
  risk corrupting stock when the correction is price-only. Rejected.
- Correct remedy: Phase 3 correction propagation owned by the sales engine
  (correction → compensating movements + sale amendment in one transaction),
  after legacy readers migrate to engine data. Recorded here so Phase 3
  implements it once, against one source of truth.

Conclusion: no seller-relevant corruption is possible through this path;
no synchronization mechanism is built in this loop.
