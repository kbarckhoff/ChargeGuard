-- CONVERGE new intake inputs (from the Nov 17 Greg meeting)
-- Run in the Supabase SQL editor. Three de-identified inputs:
--   claims_extract — the preferred claims input (replaces raw 835/837): one row
--     per adjudicated claim line with denial/CARC codes and dollar amounts, keyed
--     by a de-identified claim number for later deep-dive requests.
--   item_master    — the hospital item master, to catch device / C-code / revenue
--     code setup errors that go both ways between item master and chargemaster.
--   gl_departments — Finance GL numbers mapped to department names (+ the charge
--     number prefix that routes a charge to its department), for department rollup.

create table if not exists claims_extract (
  id             uuid primary key default uuid_generate_v4(),
  audit_id       uuid not null references audits(id) on delete cascade,
  org_id         uuid not null references organizations(id) on delete cascade,
  claim_id       text,          -- de-identified claim number (reference key)
  service_date   text,
  hcpcs          text,
  rev_code       text,
  units          numeric,
  billed_amount  numeric,
  allowed_amount numeric,
  paid_amount    numeric,
  denial_code    text,          -- CARC
  rarc_code      text,          -- RARC remark
  cas_group      text,          -- CO / PR / OA / PI / CR
  payer          text,
  created_at     timestamptz default now()
);

create table if not exists item_master (
  id             uuid primary key default uuid_generate_v4(),
  audit_id       uuid not null references audits(id) on delete cascade,
  org_id         uuid not null references organizations(id) on delete cascade,
  item_number    text,
  description    text,
  hcpcs          text,
  rev_code       text,
  c_code         text,          -- device C-code, if any
  is_device      boolean,
  charge_code    text,          -- the chargemaster line this item links to
  is_active      boolean,
  created_at     timestamptz default now()
);

create table if not exists gl_departments (
  id             uuid primary key default uuid_generate_v4(),
  audit_id       uuid not null references audits(id) on delete cascade,
  org_id         uuid not null references organizations(id) on delete cascade,
  gl_number      text,
  department_name text,
  charge_prefix  text,          -- charge numbers in this dept start with this
  created_at     timestamptz default now()
);

create index if not exists idx_claims_extract_audit on claims_extract(audit_id);
create index if not exists idx_claims_extract_hcpcs on claims_extract(audit_id, hcpcs);
create index if not exists idx_claims_extract_claim on claims_extract(audit_id, claim_id);
create index if not exists idx_item_master_audit on item_master(audit_id);
create index if not exists idx_item_master_hcpcs on item_master(audit_id, hcpcs);
create index if not exists idx_gl_departments_audit on gl_departments(audit_id);

alter table claims_extract enable row level security;
alter table item_master enable row level security;
alter table gl_departments enable row level security;
