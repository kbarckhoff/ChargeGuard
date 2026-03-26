import { createClient } from "@/lib/supabase/server";
import { Layers, AlertTriangle, FileText, CheckCircle2, Plus } from "lucide-react";
import { KPICard, Badge, SeverityDot, SEVERITY_CONFIG, ProgressBar, EmptyState } from "@/components/ui/shared";
import Link from "next/link";
import { NewAuditDialog } from "@/components/audit/NewAuditDialog";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Get user's profile
  const { data: profile } = await supabase
    .from("users")
    .select("*, organizations(*)")
    .eq("id", user!.id)
    .single();

  // Get audits
  const { data: audits } = await supabase
    .from("audits")
    .select("*")
    .order("created_at", { ascending: false });

  const currentAudit = audits?.[0];

  // If audit exists, get stats
  let stats = null;
  let phases = null;
  let recentFindings = null;

  if (currentAudit) {
    // Get phases
    const { data: phaseData } = await supabase
      .from("audit_phases")
      .select("*")
      .eq("audit_id", currentAudit.id)
      .order("phase_number");
    phases = phaseData;

    // Get task counts per phase
    const { data: tasks } = await supabase
      .from("audit_tasks")
      .select("phase_id, status")
      .eq("audit_id", currentAudit.id);

    // Get findings
    const { data: findings } = await supabase
      .from("findings")
      .select("*")
      .eq("audit_id", currentAudit.id)
      .order("created_at", { ascending: false })
      .limit(6);
    recentFindings = findings;

    // Get claims
    const { data: claims } = await supabase
      .from("claim_reviews")
      .select("id, is_reviewed")
      .eq("audit_id", currentAudit.id);

    const allFindings = (await supabase.from("findings").select("severity, status, financial_impact").eq("audit_id", currentAudit.id)).data || [];

    stats = {
      totalChargeItems: currentAudit.total_charge_items || 0,
      totalFindings: allFindings.length,
      openFindings: allFindings.filter((f: any) => f.status === "open").length,
      totalImpact: allFindings.reduce((s: number, f: any) => s + (f.financial_impact || 0), 0),
      totalTasks: tasks?.length || 0,
      completedTasks: tasks?.filter((t: any) => t.status === "completed").length || 0,
      totalClaims: claims?.length || 0,
      reviewedClaims: claims?.filter((c: any) => c.is_reviewed).length || 0,
      severityCounts: {
        critical: allFindings.filter((f: any) => f.severity === "critical").length,
        high: allFindings.filter((f: any) => f.severity === "high").length,
        medium: allFindings.filter((f: any) => f.severity === "medium").length,
        low: allFindings.filter((f: any) => f.severity === "low").length,
        info: allFindings.filter((f: any) => f.severity === "info").length,
      },
      tasksByPhase: (phases || []).map((p: any) => {
        const phaseTasks = tasks?.filter((t: any) => t.phase_id === p.id) || [];
        return {
          phaseId: p.id,
          phaseNumber: p.phase_number,
          total: phaseTasks.length,
          completed: phaseTasks.filter((t: any) => t.status === "completed").length,
        };
      }),
    };
  }

  return (
    <>
      {/* Header */}
      <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#1a1a18]">Dashboard</h1>
        <div className="flex items-center gap-3">
          <NewAuditDialog />
          <div className="w-8 h-8 rounded-full bg-[#1a1a18] flex items-center justify-center text-white text-xs font-medium">
            {profile?.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() || "U"}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {!currentAudit ? (
          /* ─── Empty State ─── */
          <div className="max-w-7xl mx-auto">
            <EmptyState
              icon={Layers}
              title="Welcome to ChargeGuard"
              description="Create your first CDM audit to get started. The system will automatically set up all 7 phases with 62 pre-configured tasks from the PARA audit process."
              action={<NewAuditDialog />}
            />
          </div>
        ) : (
          /* ─── Dashboard with data ─── */
          <div className="max-w-7xl mx-auto space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-[#1a1a18]">
                {currentAudit.hospital_name} — {currentAudit.name}
              </h2>
              <p className="text-sm text-[#7a7a75] mt-0.5">
                Comprehensive Charge Master Review • Started{" "}
                {currentAudit.start_date
                  ? new Date(currentAudit.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : "Not set"}
              </p>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KPICard
                icon={Layers}
                label="Charge Items"
                value={stats!.totalChargeItems.toLocaleString()}
                subtext={stats!.totalChargeItems === 0 ? "Import CDM to begin" : "Loaded from CDM export"}
              />
              <KPICard
                icon={AlertTriangle}
                label="Open Findings"
                value={stats!.openFindings.toString()}
                subtext={stats!.totalImpact > 0 ? `$${(stats!.totalImpact / 1000).toFixed(1)}K estimated impact` : "No findings yet"}
              />
              <KPICard
                icon={FileText}
                label="Claims Reviewed"
                value={`${stats!.reviewedClaims} / ${currentAudit.total_claims_target}`}
                subtext={`${stats!.totalClaims} claims entered`}
              />
              <KPICard
                icon={CheckCircle2}
                label="Tasks Completed"
                value={`${stats!.completedTasks} / ${stats!.totalTasks}`}
                subtext="Across all 7 phases"
              />
            </div>

            {/* Phase Progress */}
            <div className="bg-white rounded-xl border border-[#e5e5e0] p-5">
              <h3 className="text-sm font-semibold text-[#3d3d3a] mb-4">Audit Phase Progress</h3>
              <div className="grid grid-cols-7 gap-2">
                {(phases || []).map((phase: any) => {
                  const phaseStats = stats!.tasksByPhase.find((t: any) => t.phaseId === phase.id);
                  const pct = phaseStats && phaseStats.total > 0
                    ? Math.round((phaseStats.completed / phaseStats.total) * 100)
                    : 0;
                  return (
                    <Link
                      key={phase.id}
                      href={`/audits/${currentAudit.id}?phase=${phase.phase_number}`}
                      className="flex flex-col items-center p-3 rounded-xl hover:bg-[#f5f5f0] transition-colors text-center"
                    >
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm mb-1.5 ${
                          pct === 100
                            ? "bg-emerald-100 text-emerald-700"
                            : pct > 0
                            ? "bg-blue-100 text-blue-700"
                            : "bg-[#f0f0ec] text-[#7a7a75]"
                        }`}
                      >
                        {phase.phase_number}
                      </div>
                      <span className="text-[11px] font-medium text-[#3d3d3a] leading-tight">
                        {phase.name.length > 12 ? phase.name.slice(0, 12) + "…" : phase.name}
                      </span>
                      <span className="text-[10px] text-[#9a9a95] mt-0.5">{pct}%</span>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Recent Findings */}
            {recentFindings && recentFindings.length > 0 && (
              <div className="bg-white rounded-xl border border-[#e5e5e0] p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-[#3d3d3a]">Recent Findings</h3>
                  <Link href={`/audits/${currentAudit.id}`} className="text-xs text-[#7a7a75] hover:text-[#3d3d3a]">
                    View all →
                  </Link>
                </div>
                <div className="space-y-2">
                  {recentFindings.map((f: any) => (
                    <div key={f.id} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-[#fafaf8] transition-colors">
                      <SeverityDot severity={f.severity} />
                      <span className="text-sm text-[#3d3d3a] flex-1 truncate">{f.title}</span>
                      <Badge variant={f.severity === "critical" ? "danger" : f.severity === "high" ? "warning" : "default"}>
                        {f.severity}
                      </Badge>
                      {f.financial_impact && (
                        <span className="text-xs text-[#9a9a95]">
                          ${(f.financial_impact / 1000).toFixed(1)}K
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
