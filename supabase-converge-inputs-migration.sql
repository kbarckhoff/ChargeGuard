-- Converge new intake inputs (step 1: imports only)
-- Run in the Supabase SQL editor. Three de-identified inputs stored per review.
--   claims_extract — de-identified claims (claim ref #, HCPCS, billed/allowed/paid,
--     denial/CARC, RARC, payer). Preferred over raw 835/837.
--   item_master    — hospital item master (device / C-code / rev-code setup).
--   gl_departments — Finance GL numbers → department names (+ charge-code prefix).

create table if not exists claims_extract (
  id              uuid primary key default uuid_generate_v4(),
  audit_id        uuid not null references audits(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete cascade,
  claim_id        text,          -- de-identified claim control number
  line_control    text,          -- de-identified line control number (837↔835 match)
  service_date    text,
  hcpcs           text,
  mod1            text,          -- 837 line modifiers
  mod2            text,
  mod3            text,
  mod4            text,
  rev_code        text,
  units           numeric,
  dx_code         text,          -- principal diagnosis / dx pointer target
  place_of_service text,
  billed_amount   numeric,       -- 835 billed
  allowed_amount  numeric,       -- 835 allowed
  paid_amount     numeric,       -- 835 paid
  contractual_adj numeric,       -- 835 contractual adjustment (CO)
  patient_resp    numeric,       -- 835 patient responsibility (PR)
  denial_code     text,          -- CARC
  rarc_code       text,          -- RARC
  cas_group       text,          -- CO / PR / OA / PI / CR
  payer           text,
  created_at      timestamptz default now()
);

create table if not exists item_master (
  id             uuid primary key default uuid_generate_v4(),
  audit_id       uuid not null references audits(id) on delete cascade,
  org_id         uuid not null references organizations(id) on delete cascade,
  item_number    text,
  description    text,
  hcpcs          text,
  rev_code       text,
  c_code         text,
  is_device      boolean,
  charge_code    text,
  cost_center    text,          -- cost center / department on the item
  uom            text,          -- unit of measure (drug/supply billing unit)
  is_active      boolean,
  created_at     timestamptz default now()
);

create table if not exists gl_departments (
  id              uuid primary key default uuid_generate_v4(),
  audit_id        uuid not null references audits(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete cascade,
  gl_number       text,
  department_name text,
  charge_prefix   text,
  cost_center     text,          -- cost-center code, if distinct from the GL number
  created_at      timestamptz default now()
);

create index if not exists idx_claims_extract_audit on claims_extract(audit_id);
create index if not exists idx_item_master_audit on item_master(audit_id);
create index if not exists idx_gl_departments_audit on gl_departments(audit_id);

alter table claims_extract enable row level security;
alter table item_master enable row level security;
alter table gl_departments enable row level security;
