-- ============================================================
-- Lagging-EHR support
-- ------------------------------------------------------------
-- The EHR is the source of truth; users re-upload a fresh CDM each run. When a
-- finding is re-detected on a new upload but was already approved and exported
-- in a prior run (and the hospital hasn't applied it in their EHR yet), we mark
-- it "lagging" so it shows read-only under "Pending EHR Sync" instead of asking
-- for another Accept/Reject decision.
-- The change-log lifecycle status adds "approved_missing" (Approved but Missing
-- from EHR); status is a plain text column so no enum change is needed.
-- Idempotent: safe to re-run.
-- ============================================================

alter table findings add column if not exists ehr_lagging boolean not null default false;
create index if not exists idx_findings_ehr_lagging on findings(audit_id, ehr_lagging);
