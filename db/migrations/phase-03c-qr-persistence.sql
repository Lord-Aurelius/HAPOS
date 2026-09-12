-- HAPOS Phase 3c — sealed QR bearer copies (additive, idempotent).
--
-- Correction-loop follow-up: hash-only storage makes issued QR codes
-- unrecoverable after the one-time ceremony, but merchants must be able to
-- reprint the SAME active QR. These columns hold AES-256-GCM sealed bearer
-- copies (see src/server/crypto/qr-wrap.ts): verification stays hash-based,
-- and the sealed copy is only ever opened inside an authorized QR-render
-- request. Null until the next keyed issuance/rotation; rows without a copy
-- keep the reissue-to-print workflow. Never expose these columns in reads.

begin;

alter table public.seller_credentials
  add column if not exists bearer_wrapped text;

alter table public.attendance_terminals
  add column if not exists token_wrapped text;

commit;
