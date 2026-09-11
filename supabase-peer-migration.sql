-- ChargeGuard peer pricing (named-competitor benchmark)
-- Run this in the Supabase SQL editor for the ChargeGuard project.
-- Stores each competitor's gross charge per HCPCS (parsed from their
-- price-transparency machine-readable file) so the engine can benchmark the
-- client's prices against named competitors, alongside the CMS averages.

create table if not exists peer_prices (
  id           uuid primary key default uuid_generate_v4(),
  audit_id     uuid not null references audits(id) on delete cascade,
  org_id       uuid not null references organizations(id) on delete cascade,
  competitor   text not null,
  hcpcs        text not null,
  gross_charge numeric,
  created_at   timestamptz default now()
);

create index if not exists idx_peer_prices_audit on peer_prices(audit_id);
create index if not exists idx_peer_prices_hcpcs on peer_prices(audit_id, hcpcs);
create index if not exists idx_peer_prices_comp  on peer_prices(audit_id, competitor);

alter table peer_prices enable row level security;
