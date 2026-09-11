-- ChargeGuard 837 / claims support (Phase 2)
-- Run this in the Supabase SQL editor for the ChargeGuard project.
-- Stores institutional claim service lines (from an 837I file or a claim-line CSV)
-- so the engine can run claims-side checks: Modifier-25 co-billing, unbundling
-- modifiers, billed-not-in-CDM reconciliation, and unit outliers.

create table if not exists claim_lines (
  id            uuid primary key default uuid_generate_v4(),
  audit_id      uuid not null references audits(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  claim_id      text,          -- CLM01 / patient control number (de-identified)
  patient_acct  text,          -- optional account reference (de-identified)
  rev_code      text,          -- SV2-01 revenue code
  hcpcs         text,          -- SV2-02 procedure code
  mod1          text,
  mod2          text,
  mod3          text,
  mod4          text,
  units         numeric,       -- SV2-05
  line_charge   numeric,       -- SV2-03
  service_date  text,          -- DTP*472 (kept as text; format varies)
  pos           text,          -- place of service, if present
  dx_primary    text,          -- claim principal diagnosis (HI)
  created_at    timestamptz default now()
);

create index if not exists idx_claim_lines_audit on claim_lines(audit_id);
create index if not exists idx_claim_lines_claim on claim_lines(audit_id, claim_id);
create index if not exists idx_claim_lines_hcpcs on claim_lines(audit_id, hcpcs);

-- Access is via the service role (server routes) only, like the scan/import flows.
alter table claim_lines enable row level security;
