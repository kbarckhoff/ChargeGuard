import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { RunsHome } from "@/components/runs/RunsHome";

// Home = dashboard for a single hospital's CDM reviews. Lists every run
// (newest first) with KPIs ($ opportunity found, $ captured, # runs) and a
// single Start review action. The hospital is fixed per instance: it's set on
// the first review and reused thereafter.
export default async function RunsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: profile } = await db.from("users").select("org_id").eq("id", user!.id).single();

  const { data: audits } = await db
    .from("audits")
    .select("id, name, hospital_name, created_at, status, period_year, period_quarter")
    .eq("org_id", profile?.org_id)
    .order("period_year", { ascending: false, nullsFirst: false })
    .order("period_quarter", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  const headCount = async (table: string, auditId: string, extra?: (q: any) => any) => {
    let q = db.from(table).select("id", { count: "exact", head: true }).eq("audit_id", auditId);
    if (extra) q = extra(q);
    return (await q).count || 0;
  };
  // Sum of estimated financial impact on findings of a given status (paginated).
  const impactByStatus = async (auditId: string, status: string) => {
    let sum = 0;
    for (let off = 0; ; off += 1000) {
      const { data } = await db.from("findings").select("financial_impact").eq("audit_id", auditId).eq("status", status).not("financial_impact", "is", null).range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const r of data) sum += Number(r.financial_impact) || 0;
      if (data.length < 1000) break;
    }
    return sum;
  };
  const lastScanned = async (auditId: string) => {
    const { data } = await db.from("findings").select("created_at").eq("audit_id", auditId).order("created_at", { ascending: false }).limit(1);
    return data?.[0]?.created_at || null;
  };

  const runs = [] as any[];
  for (const a of audits || []) {
    runs.push({
      id: a.id,
      name: a.name,
      hospital_name: a.hospital_name || "Hospital",
      created_at: a.created_at,
      status: a.status,
      period_year: a.period_year,
      period_quarter: a.period_quarter,
      chargeItems: await headCount("charge_items", a.id),
      openFindings: await headCount("findings", a.id, (q) => q.eq("status", "open")),
      resolvedFindings: await headCount("findings", a.id, (q) => q.eq("status", "resolved")),
      criticalOpen: await headCount("findings", a.id, (q) => q.eq("status", "open").eq("severity", "critical")),
      impact: await impactByStatus(a.id, "open"),
      captured: await impactByStatus(a.id, "resolved"),
      peerCount: await headCount("peer_prices", a.id),
      lastScanned: await lastScanned(a.id),
    });
  }

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
