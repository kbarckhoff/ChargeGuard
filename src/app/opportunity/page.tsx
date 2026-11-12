import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { buildOpportunityModel, type OppFinding } from "@/lib/opportunity";
import { OpportunityView } from "@/components/converge/OpportunityView";

// CONVERGE Opportunity view: the finance-facing, net-realizable model built from
// the active review's findings. Reuses the same findings the Findings page shows.
export default async function OpportunityPage({ searchParams }: { searchParams: Promise<{ auditId?: string }> }) {
  const { auditId: wantedId } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { orgId } = await resolveActiveOrg(db, user!.id);

  // Selected run, else the most recent.
  let audit: any = null;
  if (wantedId) {
    const { data } = await db.from("audits").select("id, name, hospital_name").eq("org_id", orgId).eq("id", wantedId).maybeSingle();
    audit = data;
  }
  if (!audit) {
    const { data } = await db.from("audits").select("id, name, hospital_name").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1);
    audit = data?.[0];
  }

  const header = (
    <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
      <h1 className="text-base font-semibold text-[#0f172a]">Opportunity</h1>
    </header>
  );

  if (!audit) {
    return (
      <>
        {header}
        <div className="flex-1 overflow-y-auto p-6"><div className="max-w-5xl mx-auto text-[13px] text-[#64748b]">No review yet. Start a review and import a CDM to see the opportunity model.</div></div>
      </>
    );
  }

  // Page through the review's findings (category + financial_impact), excluding
  // already-approved (lagging) ones, same scope as the Findings page.
  const findings: OppFinding[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db
      .from("findings")
      .select("category, financial_impact, severity")
      .eq("audit_id", audit.id).eq("ehr_lagging", false)
      .range(off, off + 999);
    if (error || !data || data.length === 0) break;
    findings.push(...(data as OppFinding[]));
    if (data.length < 1000) break;
  }

  const model = buildOpportunityModel(findings);

  return (
    <>
      {header}
      <div className="flex-1 overflow-y-auto p-6">
        <OpportunityView model={model} hospitalName={audit.hospital_name || "Hospital"} reviewName={audit.name || "CDM Review"} />
      </div>
    </>
  );
}
