# Phase 0.8 — Legacy Compatibility Map

Status: **mapped**. No data migrated in Phase 0. All mappings are additive and
apply at Phase 1/2 cutover. **Nothing below fabricates history or prices.**

## service_records → future sales (+ sale_items)

| Legacy field | Target | Notes |
|---|---|---|
| id | sales.id | Preserved verbatim |
| tenantId | sales.tenant_id | Preserved |
| customerId / staffId | sales.customer_id / seller_id | Preserved; `Employee→Seller` is a role view, not a new table |
| serviceId / serviceName / isCustomService | sale_items[0].service_ref + name snapshot | Single-item sale; custom = `service_ref NULL` + name |
| **price** | sale_items[0].catalog_price **and** actual_sale_price | Split with equal values; historical overrides are **unrecoverable** (no audit existed) — flagged `override_history_unknown` |
| description / performedAt / recordedBy | sales.description / occurred_at / recorded_by | Preserved |
| commissionType/Value/Amount | sale_items[0].commission snapshot | Preserved; immune to later term changes (already true) |
| productUsages[] | sale_items[1..n] + `OPENING_USAGE` inventory movements | Movements explicitly typed as migration-derived, not observed history |
| correctedAt/correctedBy | sales audit trail seed | Preserved |
| voidedAt/voidedBy/voidReason | sales void audit | Preserved (JSON-only fields today; become real columns) |
| **idempotencyKey** | sales.idempotency_key | `null` for legacy rows; unique constraint is **partial** (`WHERE key IS NOT NULL`) so backfill never collides |

## service_record_products (SQL) / productUsages (JSON) → sale_items + inventory history

- Each usage becomes one `sale_items` row (`product_ref`, `quantity`,
  `unit_cost` snapshot) plus one `inventory_movements` row typed
  `MIGRATED_USAGE` with the original `performedAt` as movement date.
- No `quantity_on_hand` is derived from these sums (consumption without
  purchase history cannot yield a balance).

## customerOrders → future orders

| Legacy field | Target | Notes |
|---|---|---|
| id / tenantId / customerId | orders.id / tenant / customer | Preserved |
| serviceId / serviceName / quotedPrice | order_items[0] + catalog_price snapshot | Single-line order |
| requestedStaffId/Name/Phone/notes | order assignment + notes | Preserved |
| status pending/acknowledged/cancelled/approved | orders.status (same vocabulary) | 1:1 |
| approvedAt/approvedBy/approvedRecordId | order approval audit + sales link | Preserved; becomes the FK to `sales` |

## Fields with NO source of truth (merchant input required)

| Field | Why missing | Migration default | Required action |
|---|---|---|---|
| product selling_price | `products` stores only `unit_cost` (`db/schema.sql:261-271`) | `= unit_cost`, flagged `needs_pricing` | Merchant sets real prices before product checkout goes live |
| current stock quantity | No quantity column, no movements | `0`, flagged `uncounted` | Merchant performs opening stock count |
| SKU | No column | Generated `SKU-<shortid>`, editable | Merchant optionally replaces |
| reorder threshold | No column | `null` (= no alerts) until set | Merchant sets per product; alerts stay silent, never noisy-by-default |
| historical price overrides | No audit existed | `override_history_unknown` on migrated lines | Informational only |

## Explicit prohibitions (carried into Phase 1)

- Do NOT infer opening balances from summed usages.
- Do NOT fabricate selling prices from cost + assumed margin.
- Do NOT rewrite `service_records`; it stays readable and frozen for new
  writes after cutover, with `approvedRecordId` links intact.
