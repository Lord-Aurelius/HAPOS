# Phase 2A — Attendance correction decision (closure GAP 2)

Status: **deferred by decision, not by omission.**

## Decision

Correction workflow intentionally deferred. The append-only model stands:
no endpoint, action, or policy in this codebase may overwrite
`check_in_at` / `check_out_at` / `attendance_date` on an existing record.
The admin dashboard states this to admins directly.

## Rationale

1. No Phase 3 (seller QR) dependency reads corrected attendance. Seller
   attribution uses live session identity, never attendance history.
2. No payroll consumer exists; nothing computes pay from these records yet.
3. A wrong check-in/out is recoverable operationally today (void-equivalent:
   admin sees the record; the employee's next correct cycle is unaffected
   because only one OPEN record is constrained — closed records never block).
4. Building an audited correction UI now would expand scope without a
   consumer, violating the closure mandate against manufactured features.

## Agreed future shape (when a consumer requires it)

```
attendance_corrections
  attendance_record_id  → original record (never mutated)
  previous_check_in_at / previous_check_out_at
  corrected_check_in_at / corrected_check_out_at
  reason (mandatory)
  corrected_by / corrected_at
```

Reads then resolve `effective = correction ?? original`. Until then, the
`attendance_records_update_policy` RLS path stays admin-only and unused by
any application write path.
