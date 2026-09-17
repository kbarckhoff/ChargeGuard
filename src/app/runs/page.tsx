import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { RunsHome } from "@/components/runs/RunsHome";

// Home = dashboard for a single hospital's CDM reviews. Lists every run
// (newest first) with KPIs ($ opportunity found, $ captured, # runs) and a
// single Start review action. The hospital is fixed per instance: it's set on
// the first review and reused thereafter.
export default async function RunsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { orgId: __org } = await resolveActiveOrg(db, user!.id);
  const profile = { org_id: __org };

  // Fetch the run list and every run's KPIs in parallel. run_stats() returns
  // all counts + impact sums for the org in a single query (see the perf-indexes
  // migration), replacing the old ~100 sequential per-run queries.
  const [{ data: audits }, { data: statRows }] = await Promise.all([
    db
      .from("audits")
      .select("id, name, hospital_name, created_at, status, period_year, period_quarter")
      .eq("org_id", profile?.org_id)
      .order("period_year", { ascending: false, nullsFirst: false })
      .order("period_quarter", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
    db.rpc("run_stats", { p_org: profile?.org_id }),
  ]);

  const statById: Record<string, any> = {};
  for (const s of (statRows as any[]) || []) statById[s.audit_id] = s;

  const runs = (audits || []).map((a: any) => {
    const s = statById[a.id] || {};
    return {
      id: a.id,
      name: a.name,
      hospital_name: a.hospital_name || "Hospital",
      created_at: a.created_at,
      status: a.status,
      period_year: a.period_year,
      period_quarter: a.period_quarter,
      chargeItems: Number(s.charge_items) || 0,
      openFindings: Number(s.open_findings) || 0,
      resolvedFindings: Number(s.resolved_findings) || 0,
      criticalOpen: Number(s.critical_open) || 0,
      impact: Number(s.open_impact) || 0,
      captured: Number(s.captured_impact) || 0,
      peerCount: Number(s.peer_count) || 0,
      lastScanned: s.last_scanned || null,
    };
  });

  // KPIs for this hospital's reviews.
  const kpis = {
    opportunityFound: runs.reduce((s, r) => s + r.impact, 0),
    captured: runs.reduce((s, r) => s + r.captured, 0),
    runCount: runs.length,
  };

  // Fixed hospital for this instance: taken from the most recent run (runs are
  // sorted newest first). Null until the first review is started.
  const hospitalName: string | null = runs[0]?.hospital_name ?? null;

  const now = new Date();
  const curQ = Math.floor(now.getMonth() / 3) + 1;
  const curY = now.getFullYear();

  return (
    <RunsHome
      runs={runs}
      kpis={kpis}
      currentQuarter={{ q: curQ, y: curY }}
      hospitalName={hospitalName}
    />
  );
}
