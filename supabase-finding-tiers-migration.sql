-- ============================================================
-- Finding tiers + N/A disposition memory
-- ------------------------------------------------------------
-- Tiers rank a finding by its prior-review history for the same line+category:
--   1 = brand new
--   2 = previously ACCEPTED, showing up again
--   3 = previously DENIED (rejected), showing up again
--   4 = previously marked N/A, showing up again
--
-- The prior disposition is remembered in finding_exceptions.disposition, which
-- now records accepted / rejected / na (not just rejections). The scan reads it
-- to stamp findings.tier on each new run.
-- Idempotent: safe to re-run.
-- ============================================================

-- The 'na' (N/A) disposition is a real finding_status the UI/API offer, but the
-- original enum only had open/in_review/accepted/rejected/resolved. Add it so the
-- N/A disposition can persist (without this, N/A returns a 500 on save).
-- Note: ALTER TYPE ... ADD VALUE must run outside a transaction block.
alter type finding_status add value if not exists 'na';

alter table findings add column if not exists tier smallint;
alter table finding_exceptions add column if not exists disposition text;

-- Backfill: every existing exception row was created from a rejection.
update finding_exceptions set disposition = 'rejected' where disposition is null;
