-- Original file position of each charge line, captured at import, so the
-- Findings "By CDM line" view can show a real record number (record 1 = the
-- first data row / Excel row 2) instead of the CDM charge code.
alter table charge_items add column if not exists source_row integer;
create index if not exists idx_charge_items_audit_srcrow on charge_items(audit_id, source_row);
