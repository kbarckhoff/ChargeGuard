-- ============================================================
-- R&U billed modifier
-- ------------------------------------------------------------
-- The Missing-Modifier flag compares the modifier ACTUALLY BILLED (from the R&U
-- / utilization export) against the modifier on the CDM line. Store the billed
-- modifier per charge line so the scan can do that comparison.
-- Idempotent: safe to re-run.
-- ============================================================

alter table charge_usage add column if not exists modifier text;
