-- Fast findings summary for the Findings & Analysis page.
-- Returns one row per (category, status) for a review, with a count and summed
-- financial impact. The page derives the summary cards, status counts, class
-- breakdown, and roll-up from this instead of pulling every finding row
-- (a large review has 18k+ rows, which made every filter change slow).

create or replace function findings_rollup(p_audit uuid)
returns table(category text, status text, cnt bigint, impact numeric)
language sql
stable
security definer
set search_path = public
as $$
  select category, status, count(*)::bigint as cnt,
         coalesce(sum(financial_impact), 0)::numeric as impact
  from findings
  where audit_id = p_audit
    and coalesce(ehr_lagging, false) = false
  group by category, status
$$;

grant execute on function findings_rollup(uuid) to anon, authenticated, service_role;

-- Supports the grouped scan above.
create index if not exists idx_findings_audit_notlagging
  on findings (audit_id) where coalesce(ehr_lagging, false) = false;
