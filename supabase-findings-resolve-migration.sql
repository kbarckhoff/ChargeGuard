-- Findings resolve-with-fix: record the exact CDM change applied when a finding
-- is resolved, so every correction is auditable and can be exported.
alter table findings add column if not exists applied_field text;
alter table findings add column if not exists applied_old   text;
alter table findings add column if not exists applied_new   text;
alter table findings add column if not exists resolution_note text;
