-- ============================================================
-- Change-log workflow: remediation + two-stage confirmation
-- ------------------------------------------------------------
-- Adds the columns behind the accept → assign → implement → verify flow:
--   completed_by  — the assignee who marked the Work Queue task implemented
--   verified_at   — when a later CDM upload confirmed the change is present
-- The "approver" column is retired (no approval step); "requested_by" is now the
-- reviewer/analyst who decided (accepted) the change. Status lifecycle:
--   pending → implemented (assignee marked done) → verified (next run confirms)
--                                                → approved_missing (not found)
-- Idempotent: safe to re-run.
-- ============================================================

alter table cdm_change_log add column if not exists completed_by uuid references users(id) on delete set null;
alter table cdm_change_log add column if not exists verified_at  timestamptz;
