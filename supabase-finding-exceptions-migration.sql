-- ============================================================
-- Carry-forward exceptions
-- ------------------------------------------------------------
-- When a finding is rejected with a reason, we remember it as a persistent
-- "exception" keyed to the CDM line (its procedure number, else HCPCS) + the
-- finding category. On the next run the same finding is auto-carried (marked
-- rejected with the saved reason) instead of re-litigated -- UNLESS the charge
-- materially changed, in which case it re-surfaces as open for a fresh look.
-- Idempotent: safe to re-run.
-- ============================================================

create table if not exists finding_exceptions (
  id                       uuid primary key default uuid_generate_v4(),
  org_id                   uuid not null references organizations(id) on delete cascade,
  line_key                 text not null,          -- CDM line identity: procedure_number, else hcpcs
  category                 text not null,          -- finding category / rule
  procedure_number         text,
  hcpcs                    text,
  reason                   text,                   -- the rejection note
  status                   text not null default 'active',  -- active | cleared
  snapshot_charge          numeric(12,2),          -- gross charge at time of rejection
  snapshot_impact          numeric(12,2),          -- financial impact at time of rejection
  first_rejected_audit_id  uuid references audits(id) on delete set null,
  last_seen_audit_id       uuid references audits(id) on delete set null,
  rejected_by              uuid references users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (org_id, line_key, category)
);
create index if not exists idx_finding_exceptions_org on finding_exceptions(org_id);
create index if not exists idx_finding_exceptions_active on finding_exceptions(org_id, status);

-- Mark findings that were auto-carried from a prior review's rejection.
alter table findings add column if not exists is_carried boolean not null default false;
