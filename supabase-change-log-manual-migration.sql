-- ============================================================
-- Manual change-log entries (documentation / audit trail)
-- ------------------------------------------------------------
-- Lets a reviewer document a CDM update the tool did NOT flag (e.g. a newly
-- added service, a locally-decided price change) so it's tracked for audit.
--
-- Manual entries are documentation ONLY:
--   * source = 'manual', status = 'logged'
--   * they never feed the rule analysis or findings
--   * the smart-sync reconcile ignores them (it only touches exported /
--     approved_missing tool entries), so they can't create false
--     "approved change missing" prompts
-- If the hospital actually changes the CDM, that change is picked up normally
-- when the CDM is re-uploaded and re-scanned.
-- Idempotent: safe to re-run.
-- ============================================================

alter table cdm_change_log add column if not exists source text not null default 'tool';

-- The tool dedups one live change per line+field. Manual entries are free-form
-- audit records (a user may log several changes to the same line over time), so
-- the uniqueness constraint applies to tool-generated rows only.
drop index if exists uq_cdm_change_log_live;
create unique index if not exists uq_cdm_change_log_live
  on cdm_change_log(org_id, line_key, field)
  where status <> 'void' and source = 'tool';
