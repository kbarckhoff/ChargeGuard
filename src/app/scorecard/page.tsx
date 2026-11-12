import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { buildScorecard } from "@/lib/scorecard";
import type { OppFinding } from "@/lib/opportunity";
import { ScorecardView } from "@/components/converge/ScorecardView";

// CONVERGE RC Health Scorecard: the "State of the Revenue Cycle" one-pager, built
// from the active review's findings. Areas needing the 835/837 files show pending.
export default async function ScorecardPage({ searchParams }: { searchParams: Promise<{ auditId?: string }> }) {
  const { auditId: wantedId } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { orgId } = await resolveActiveOrg(db, user!.id);

  let audit: any = null;
  if (wantedId) {
    const { data } = await db.from("audits").select("id, name, hospital_name, metadata").eq("org_id", orgId).eq("id", wantedId).maybeSingle();
    audit = data;
  }
  if (!audit) {
    const { data } = await db.from("audits").select("id, name, hospital_name, metadata").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1);
    audit = data?.[0];
  }

  const deckHref = audit ? `/api/converge/decide-deck?auditId=${audit.id}` : "/api/converge/decide-deck";
  const header = (
    <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
      <h1 className="text-base font-semibold text-[#0f172a]">RC Health Scorecard</h1>
      {audit && (
        <a href={deckHref} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#4f46e5] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[#4338ca] transition-colors">
          Decide deck
        </a>
      )}
    </header>
  );
  if (!audit) {
    return <>{header}<div className="flex-1 overflow-y-auto p-6"><div className="max-w-5xl mx-auto text-[13px] text-[#64748b]">No review yet. Start a review and import a CDM to generate the scorecard.</div></div></>;
  }

  const findings: OppFinding[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from("findings").select("category, financial_impact, severity").eq("audit_id", audit.id).eq("ehr_lagging", false).range(off, off + 999);
    if (error || !data || data.length === 0) break;
    findings.push(...(data as OppFinding[]));
    if (data.length < 1000) break;
  }
  // Have the claims/remittance files been ingested for this run?
  const { count: claimCount } = await db.from("claim_lines").select("id", { count: "exact", head: true }).eq("audit_id", audit.id);
  const md0 = (audit.metadata as any) || {};
  const cm = md0.claims_metrics || null;
  const hasClaims = (claimCount || 0) > 0 || !!cm;
  const claims = cm ? {
    firstPassYield: cm.firstPassYield ?? null,
    denialRate: cm.denialRate ?? null,
    netCollectionYield: cm.netCollectionYield ?? null,
    areaDenials: md0.claims_area_denials || {},
  } : undefined;

  const sc = buildScorecard(findings, { hasClaims, claims });
  const period = md0.review_period || "Current period";

  return (
    <>
      {header}
      <div className="flex-1 overflow-y-auto p-6">
        <ScorecardView sc={sc} facility={audit.hospital_name || "Hospital"} period={period} />
      </div>
    </>
  );
}
