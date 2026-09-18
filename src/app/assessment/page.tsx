import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClientLib } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { AssessmentFlow } from "@/components/assessment/AssessmentFlow";
import { EmptyState } from "@/components/ui/shared";
import { ClipboardList } from "lucide-react";
import { CreateAuditForm } from "@/components/audit/CreateAuditForm";

export default async function AssessmentPage({ searchParams }: { searchParams: Promise<{ auditId?: string }> }) {
  const { auditId: wantedId } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const admin = createAdminClientLib(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { orgId: __org } = await resolveActiveOrg(admin, user!.id);
  const profile = { org_id: __org };
  // Load the selected quarter run when one is chosen on the home page; otherwise
  // fall back to the most recent run.
  let audit: any = null;
  if (wantedId) {
    const { data } = await admin.from("audits").select("*").eq("org_id", profile?.org_id).eq("id", wantedId).maybeSingle();
    audit = data;
  }
  if (!audit) {
    const { data: audits } = await admin.from("audits").select("*").eq("org_id", profile?.org_id).order("created_at", { ascending: false }).limit(1);
    audit = audits?.[0];
  }

  if (!audit) {
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl mx-auto">
          <EmptyState icon={ClipboardList} title="Start a new assessment" description="Create your first engagement to begin the intake, imports, and analysis flow." action={<CreateAuditForm />} />
        </div>
      </div>
    );
  }

  // findings stats (paginated)
  const findings: { severity: string; status: string; financial_impact: number | null }[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await admin.from("findings").select("severity, status, financial_impact").eq("audit_id", audit.id).range(off, off + 999);
    if (error || !data || data.length === 0) break;
    findings.push(...data);
    if (data.length < 1000) break;
  }
  const cnt = async (t: string) => (await admin.from(t).select("id", { count: "exact", head: true }).eq("audit_id", audit.id)).count || 0;
  const chargeItems = await cnt("charge_items");
  const counts = { ru: await cnt("charge_usage"), formulary: await cnt("charge_formulary"), claims: await cnt("claim_lines") };
  // Per-competitor peer price counts (for loaded status + per-row lock)
  const peerCounts: Record<string, number> = {};
  for (let off = 0; ; off += 1000) {
    const { data } = await admin.from("peer_prices").select("competitor").eq("audit_id", audit.id).range(off, off + 999);
    if (!data || data.length === 0) break;
    for (const r of data) peerCounts[r.competitor] = (peerCounts[r.competitor] || 0) + 1;
    if (data.length < 1000) break;
  }

  // TEMP (testing): force the tool-owner view so the Peer Setup step is visible.
  // For real role gating, replace with:
  //   const ownerList = (process.env.OWNER_EMAILS || "kbarckhoff@gmail.com").split(",").map((s) => s.trim().toLowerCase());
  //   const isOwner = ownerList.includes((user?.email || "").toLowerCase());
  const isOwner = true;

  const stats = {
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
    total: findings.length,
    open: findings.filter((f) => f.status === "open").length,
    impact: findings.reduce((s, f) => s + (f.financial_impact || 0), 0),
  };

  return (
    <AssessmentFlow
      auditId={audit.id}
      hospitalName={audit.hospital_name || "Sample Hospital"}
      auditName={audit.name || "CDM Review"}
      chargeItems={chargeItems}
      counts={counts}
      stats={stats}
      peerCounts={peerCounts}
      isOwner={isOwner}
      disabledRules={Array.isArray(audit.disabled_rules) ? audit.disabled_rules : []}
      status={audit.status || "in_progress"}
      intakeLocked={!!(audit.metadata as any)?.intake_locked}
      reviewPeriod={(audit.metadata as any)?.review_period || ""}
      lowVolume={(audit.metadata as any)?.low_volume_threshold ?? null}
      initialComps={Array.isArray((audit.metadata as any)?.competitors) ? (audit.metadata as any).competitors : null}
    />
  );
}
