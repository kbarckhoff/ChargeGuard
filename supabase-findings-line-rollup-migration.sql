-- Per-CDM-line rollup for the Findings page: one row per charge line that has at
-- least one (non-lagging) finding, with the number of issues on that line, the
-- line's single largest finding impact (used for max-per-line dedup so a line
-- with several issues is not double-counted), and the line's dominant category
-- (the category of its largest-impact finding). Includes the line's code and
-- description so the UI can render per-line cards without a second query.
--
-- Also returns the full set of categories present on the line (so the UI can
-- filter by ANY issue on a line, not just its dominant one) and a per-category
-- breakdown of count + max impact (so that when a category filter is active the
-- issue count and dollars shown reflect THAT category, not the whole line).
--
-- Safe to run multiple times.
-- NOTE: this adds output columns (categories, by_category) to an existing
-- function. Postgres can't change a function's return type with CREATE OR
-- REPLACE, so drop the old signature first.
drop function if exists findings_line_rollup(uuid);
create or replace function findings_line_rollup(p_audit uuid)
returns table (
  charge_item_id uuid,
  issue_count bigint,
  max_impact numeric,
  dominant_category text,
  categories text[],
  by_category jsonb,
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
  by_cat as (
    -- one row per (line, category): how many issues of that category on the line
    -- and the largest single impact among them.
    select charge_item_id, category, count(*)::bigint as c, max(fi) as m
    from scoped
    group by charge_item_id, category
  ),
  per_line as (
    select charge_item_id,
           sum(c)::bigint as issue_count,
           max(m) as max_impact,
           array_agg(coalesce(category, 'Uncategorized') order by m desc, category) as categories,
           jsonb_object_agg(coalesce(category, 'Uncategorized'),
                            jsonb_build_object('c', c, 'm', m)) as by_category
    from by_cat
    group by charge_item_id
  ),
  dom as (
    select distinct on (charge_item_id) charge_item_id, category as dominant_category
    from by_cat
    order by charge_item_id, m desc, category
  )
  select pl.charge_item_id,
         pl.issue_count,
         pl.max_impact,
         d.dominant_category,
         pl.categories,
         pl.by_category,
         ci.procedure_number::text,
         ci.hcpcs_cpt_code::text,
         ci.charge_description::text,
         ci.gross_charge::numeric
  from per_line pl
  join dom d using (charge_item_id)
  left join charge_items ci on ci.id = pl.charge_item_id;
$$;
