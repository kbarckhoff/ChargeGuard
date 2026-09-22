-- Performance pass 2: indexes for query patterns added since the first pass.
-- All are additive and safe to run anytime.

-- Findings are very frequently filtered by audit + category (every tab/class
-- scope, the by-line and group endpoints). This composite covers those.
create index if not exists idx_findings_audit_category on findings(audit_id, category);

-- Scan loads these per-audit each run; index the join key.
create index if not exists idx_charge_usage_audit    on charge_usage(audit_id);
create index if not exists idx_charge_formulary_audit on charge_formulary(audit_id);
create index if not exists idx_claim_lines_audit      on claim_lines(audit_id);

-- Charge lines are looked up by code within an audit (group disposition, by-line).
create index if not exists idx_charge_items_audit_hcpcs on charge_items(audit_id, hcpcs_cpt_code);

-- Change-log reconcile + accept/void paths.
create index if not exists idx_cdm_change_log_org        on cdm_change_log(org_id);
create index if not exists idx_cdm_change_log_src_finding on cdm_change_log(source_finding_id);

-- Finding-activity (audit log) reads by finding/audit.
create index if not exists idx_finding_activity_audit on finding_activity(audit_id);
