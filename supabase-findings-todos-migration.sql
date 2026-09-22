-- Grouped "to-do" view for the Findings page.
-- Collapses findings that share a root cause (same category + same HCPCS code)
-- into one row, so the reviewer sees distinct fixes instead of one row per line.
-- Findings with no code (e.g. missing-code, non-billable) stay individual, keyed
-- by the finding id. grp_key encodes which kind:
--   'C:<category>|<code>'  -> a code-level fix spanning line_count lines
--   'L:<finding uuid>'     -> a single line with no code to group on
create or replace function findings_todos(p_audit uuid)
returns table(
  grp_key text,
  category text,
  code text,
  line_count bigint,
  open_count bigint,
  impact numeric,
  sample_title text,
  sample_proc text
)
language sql
stable
security definer
set search_path = public
as $$
  with f as (
    select fd.id, fd.category, fd.title, fd.status, fd.financial_impact,
           coalesce(nullif(ci.hcpcs_cpt_code, ''), '') as code,
           ci.procedure_number as proc
    from findings fd
    left join charge_items ci on ci.id = fd.charge_item_id
    where fd.audit_id = p_audit and coalesce(fd.ehr_lagging, false) = false
  )
  select
    case when code <> '' then 'C:' || category || '|' || code else 'L:' || id::text end as grp_key,
    max(category) as category,
    max(code) as code,
    count(*)::bigint as line_count,
    count(*) filter (where status in ('open', 'in_review'))::bigint as open_count,
    coalesce(sum(financial_impact), 0)::numeric as impact,
    min(title) as sample_title,
    min(proc) as sample_proc
  from f
  group by case when code <> '' then 'C:' || category || '|' || code else 'L:' || id::text end
$$;

grant execute on function findings_todos(uuid) to anon, authenticated, service_role;
