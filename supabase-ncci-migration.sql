-- NCCI reference layer (Converge rules batch 2)
-- Run in the Supabase SQL editor for the ChargeGuard project.
--
-- Two public CMS NCCI data sets, refreshed quarterly by the reference cron /
-- GitHub Action like the other CMS sources:
--   ncci_ptp  — Procedure-to-Procedure edit PAIRS (hospital outpatient). Column1
--               is the comprehensive code, Column2 the component; modifier_indicator
--               0 = never unbundled, 1 = a modifier may override, 9 = not applicable.
--   MUE       — Medically Unlikely Edits are per-HCPCS unit caps, so they live as
--               columns on the existing cms_reference table (one row per HCPCS).

create table if not exists ncci_ptp (
  id                 bigint generated always as identity primary key,
  col1               text not null,       -- comprehensive / Column 1 code
  col2               text not null,       -- component / Column 2 code
  modifier_indicator text,                -- '0' | '1' | '9'
  effective          text,                -- effective date (as published)
  deletion           text,                -- deletion date, if retired
  created_at         timestamptz default now()
);
create unique index if not exists idx_ncci_ptp_pair on ncci_ptp(col1, col2);
create index if not exists idx_ncci_ptp_col1 on ncci_ptp(col1);

alter table ncci_ptp enable row level security;

-- MUE: per-HCPCS unit cap + Medicare Adjudication Indicator, on cms_reference.
alter table cms_reference add column if not exists mue integer;       -- max units of service
alter table cms_reference add column if not exists mue_mai text;      -- MAI: 1 line, 2 date, 3 clinical
