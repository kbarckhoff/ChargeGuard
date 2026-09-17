-- ============================================================
-- CDM Change Log
-- ------------------------------------------------------------
-- The change log is the source of truth for ACCEPTED changes, sitting between
-- the uploaded baseline CDM and the exported updated CDM. Accepting a finding
-- writes a "pending" entry here (it does NOT mutate the baseline). "Generate
-- Updated CDM" overlays accepted entries on the baseline and flips them to
-- "exported". On the next upload, smart-sync marks entries "implemented" once
-- the hospital's EHR reflects them.
-- Idempotent: safe to re-run.
-- ============================================================

create table if not exists cdm_change_log (
  id                 uuid primary key default uuid_generate_v4(),
  org_id             uuid not null references organizations(id) on delete cascade,
  audit_id           uuid references audits(id) on delete set null,  -- run it originated in
  change_number      int,                                            -- per-org display sequence
  line_key           text not null,        -- CDM line identity: procedure_number, else hcpcs
  procedure_number   text,
  hcpcs              text,
  description        text,                 -- line description (for display)
  action_type        text not null default 'modify',  -- add | modify | deactivate
  field              text,                 -- price | description | hcpcs | revenue_code | modifier | status
  old_value          text,
  new_value          text,
  rationale          text,
  effective_date     date,
  status             text not null default 'pending',  -- pending | exported | implemented | void
  source             text not null default 'tool',   -- tool | manual (manual = documentation-only)
  source_finding_id  uuid references findings(id) on delete set null,
  requested_by       uuid references users(id) on delete set null,
  approver           uuid references users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  exported_at        timestamptz,
  implemented_at     timestamptz
);
create index if not exists idx_cdm_change_log_org on cdm_change_log(org_id);
create index if not exists idx_cdm_change_log_status on cdm_change_log(org_id, status);
create index if not exists idx_cdm_change_log_audit on cdm_change_log(audit_id);
-- One live (non-void) change per line+field for TOOL entries, so re-accepting
-- updates rather than duplicates. Manual (documentation) entries are exempt.
create unique index if not exists uq_cdm_change_log_live
  on cdm_change_log(org_id, line_key, field)
  where status <> 'void' and source = 'tool';
