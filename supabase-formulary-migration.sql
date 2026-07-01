-- ChargeGuard Formulary support
-- Run in the Supabase SQL editor for the ChargeGuard project.
-- Stores the pharmacy formulary / drug master per charge code so the engine can
-- flag inactive-but-billed drugs, NDC mismatches, and (with the ASP dosage)
-- billing-unit / UOM issues.

create table if not exists charge_formulary (
  id          uuid primary key default uuid_generate_v4(),
  audit_id    uuid not null references audits(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  charge_code text,
  status      text,
  ndc         text,
  drug_name   text,
  pkg_amt     numeric,
  pkg_unit    text,
  created_at  timestamptz default now()
);
create index if not exists idx_charge_formulary_audit on charge_formulary(audit_id);
create index if not exists idx_charge_formulary_code  on charge_formulary(audit_id, charge_code);
alter table charge_formulary enable row level security;
