-- Per-CDM-line rollup for the Findings page: one row per charge line that has at
-- least one (non-lagging) finding, with the number of issues on that line, the
-- line's single largest finding impact (used for max-per-line dedup so a line
-- with several issues is not double-counted), and the line's dominant category
-- (the category of its largest-impact finding). Includes the line's code and
-- description so the UI can render per-line cards without a second query.
--
-- Safe to run multiple times.
create or replace function findings_line_rollup(p_audit uuid)
returns table (
  charge_item_id uuid,
  issue_count bigint,
  max_impact numeric,
  dominant_category text,
  proc text,
  hcpcs text,
  description text,
  gross numeric
)
language sql
stable
as $$
  with scoped as (
    select f.charge_item_id, f.category, coalesce(f.financial_impact, 0) as fi
    from findings f
    where f.audit_id = p_audit
      and f.ehr_lagging = false
      and f.charge_item_id is not null
  ),
  per_line as (
    select charge_item_id,
           count(*)::bigint as issue_count,
           max(fi) as max_impact
    from scoped
    group by charge_item_id
  ),
  dom as (
    select distinct on (charge_item_id) charge_item_id, category as dominant_category
    from scoped
    order by charge_item_id, fi desc, category
  )
  select pl.charge_item_id,
         pl.issue_count,
         pl.max_impact,
         d.dominant_category,
         ci.procedure_number::text,
         ci.hcpcs_cpt_code::text,
         ci.charge_description::text,
         ci.gross_charge::numeric
  from per_line pl
  join dom d using (charge_item_id)
  left join charge_items ci on ci.id = pl.charge_item_id;
$$;
