-- ============================================================
-- Performance: indexes + one-shot run stats
-- ------------------------------------------------------------
-- The app was doing full-table scans for every count/sum (findings and
-- charge_items had no index on audit_id), and the /runs page summed financial
-- impact by paging through thousands of rows per audit. These indexes turn the
-- counts/scans into index lookups, and run_stats() returns every run's KPIs in
-- a single round trip instead of ~100 sequential queries.
-- Idempotent: safe to re-run.
-- ============================================================

create index if not exists idx_findings_audit            on findings(audit_id);
create index if not exists idx_findings_audit_status      on findings(audit_id, status);
create index if not exists idx_findings_audit_severity    on findings(audit_id, severity);
create index if not exists idx_findings_audit_lagging     on findings(audit_id, ehr_lagging);
create index if not exists idx_findings_charge_item       on findings(charge_item_id);
create index if not exists idx_charge_items_audit         on charge_items(audit_id);
create index if not exists idx_peer_prices_audit          on peer_prices(audit_id);

-- Per-run KPIs for the whole org in one query.
create or replace function run_stats(p_org uuid)
returns table (
  audit_id           uuid,
  charge_items       bigint,
  open_findings      bigint,
  resolved_findings  bigint,
  critical_open      bigint,
  open_impact        numeric,
  captured_impact    numeric,
  peer_count         bigint,
  last_scanned       timestamptz
) language sql stable as $$
  select
    a.id,
    (select count(*) from charge_items ci where ci.audit_id = a.id),
    (select count(*) from findings f where f.audit_id = a.id and f.status = 'open'),
    (select count(*) from findings f where f.audit_id = a.id and f.status = 'resolved'),
    (select count(*) from findings f where f.audit_id = a.id and f.status = 'open' and f.severity = 'critical'),
    coalesce((select sum(f.financial_impact) from findings f where f.audit_id = a.id and f.status = 'open'), 0),
    coalesce((select sum(f.financial_impact) from findings f where f.audit_id = a.id and f.status = 'resolved'), 0),
    (select count(*) from peer_prices p where p.audit_id = a.id),
    (select max(f.created_at) from findings f where f.audit_id = a.id)
  from audits a
  where a.org_id = p_org;
$$;
