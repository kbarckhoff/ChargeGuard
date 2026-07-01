-- ChargeGuard R&U (Revenue & Usage) support
-- Run this in the Supabase SQL editor for the ChargeGuard project.
-- Stores annual revenue/utilization per charge code so the engine and report can
-- compute R&U-weighted gross, MC+MA impact, payer mix, and department rollups —
-- the data Greg's Executive Summary is built on.

create table if not exists charge_usage (
  id          uuid primary key default uuid_generate_v4(),
  audit_id    uuid not null references audits(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  charge_code text,
  hcpcs       text,
  department  text,
  units       numeric,
  gross       numeric,
  visits      numeric,
  medicare    numeric,
  mc_adv      numeric,
  mc_ma       numeric,
  created_at  timestamptz default now()
);

create index if not exists idx_charge_usage_audit on charge_usage(audit_id);
create index if not exists idx_charge_usage_code  on charge_usage(audit_id, charge_code);

-- Access is via the service role (server routes) only, like the scan/import flows.
alter table charge_usage enable row level security;
