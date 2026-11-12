-- CONVERGE 835 / remittance support (Phase B)
-- Run this in the Supabase SQL editor for the ChargeGuard/Converge project.
-- Stores adjudicated claim- and line-level remittance (from an 835 ERA or a
-- remit CSV) so the engine's cross-file joins can compute first-pass yield,
-- denial rate, net collection yield, and the denial → claim → CDM trace.

-- Claim-level adjudication (one row per CLP).
create table if not exists remit_claims (
  id            uuid primary key default uuid_generate_v4(),
  audit_id      uuid not null references audits(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  claim_id      text,          -- CLP01 patient control number (de-identified)
  status        text,          -- CLP02 claim status (1 paid, 4 denied, …)
  total_charge  numeric,       -- CLP03 submitted
  total_paid    numeric,       -- CLP04 paid
  patient_resp  numeric,       -- CLP05 patient responsibility
  payer_control text,          -- CLP07 payer claim control number
  adjustments   jsonb,         -- claim-level CAS: [{group,carc,amount}]
  created_at    timestamptz default now()
);

-- Line-level adjudication (one row per SVC).
create table if not exists remit_lines (
  id            uuid primary key default uuid_generate_v4(),
  audit_id      uuid not null references audits(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  claim_id      text,          -- parent CLP01
  hcpcs         text,          -- SVC01 procedure
  mod1          text,
  rev_code      text,          -- SVC04 (NUBC)
  line_charge   numeric,       -- SVC02 submitted
  line_paid     numeric,       -- SVC03 paid
  units         numeric,       -- SVC05
  adjustments   jsonb,         -- line-level CAS: [{group,carc,amount}]
  created_at    timestamptz default now()
);

create index if not exists idx_remit_claims_audit on remit_claims(audit_id);
create index if not exists idx_remit_claims_claim on remit_claims(audit_id, claim_id);
create index if not exists idx_remit_lines_audit on remit_lines(audit_id);
create index if not exists idx_remit_lines_claim on remit_lines(audit_id, claim_id);
create index if not exists idx_remit_lines_hcpcs on remit_lines(audit_id, hcpcs);

alter table remit_claims enable row level security;
alter table remit_lines enable row level security;
