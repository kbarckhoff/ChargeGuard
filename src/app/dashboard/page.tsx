import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClientLib } from "@supabase/supabase-js";
import { Layers, AlertTriangle, CheckCircle2, Zap, FileSpreadsheet, Upload } from "lucide-react";
import { KPICard, Badge, SeverityDot, SEVERITY_CONFIG, ProgressBar, EmptyState } from "@/components/ui/shared";
import Link from "next/link";
import { ScanButton } from "@/components/audit/ScanButton";
import { CreateAuditForm } from "@/components/audit/CreateAuditForm";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const supabaseAdmin = createAdminClientLib(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Get user profile
  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("*, organizations(*)")
    .eq("id", user!.id)
    .single();

  // Get most recent audit
  const { data: audits } = await supabaseAdmin
    .from("audits")
    .select("*")
    .eq("org_id", profile?.org_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const audit = audits?.[0];

  // Get stats if audit exists
  let stats = null;
  if (audit) {
    const [findingsRes, chargeCount] = await Promise.all([
      supabaseAdmin.from("findings").select("severity, status, financial_impact").eq("audit_id", audit.id),
      supabaseAdmin.from("charge_items").select("id", { count: "exact", head: true }).eq("audit_id", audit.id),
    ]);

    const findings = findingsRes.data || [];
    stats = {
      chargeItems: chargeCount.count || 0,
      totalFindings: findings.length,
      openFindings: findings.filter((f) => f.status === "open").length,
      acceptedFindings: findings.filter((f) => f.status === "accepted").length,
      resolvedFindings: findings.filter((f) => f.status === "resolved").length,
      rejectedFindings: findings.filter((f) => f.status === "rejected").length,
      totalImpact: findings.reduce((s, f) => s + (f.financial_impact || 0), 0),
      severityCounts: {
        critical: findings.filter((f) => f.severity === "critical").length,
        high: findings.filter((f) => f.severity === "high").length,
        medium: findings.filter((f) => f.severity === "medium").length,
        low: findings.filter((f) => f.severity === "low").length,
      },
    };
  }

  return (
    <>
      <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#1a1a18]">Dashboard</h1>
        <div className="w-8 h-8 rounded-full bg-[#1a1a18] flex items-center justify-center text-white text-xs font-medium">
          {profile?.full_name?.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase() || "U"}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {!audit ? (
          <div className="max-w-xl mx-auto">
            <EmptyState
              icon={Layers}
              title="Welcome to ChargeGuard"
              description="Create your first audit engagement to get started. Upload a hospital's charge master and the scanner will identify coding errors, compliance issues, and revenue opportunities."
              action={<CreateAuditForm />}
            />
          </div>
        ) : (
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#1a1a18]">{audit.hospital_name}</h2>
                <p className="text-sm text-[#7a7a75] mt-0.5">{audit.name}</p>
              </div>
              <ScanButton auditId={audit.id} />
            </div>

            {/* Workflow Steps */}
            {stats && stats.chargeItems === 0 && (
              <div className="p-5 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-center gap-3">
                  <Upload size={20} className="text-blue-600" />
                  <div>
                    <p className="text-sm font-medium text-blue-900">Next step: Upload the charge master</p>
                    <p className="text-sm text-blue-700 mt-0.5">
                      Go to{" "}
                      <Link href="/charge-master" className="underline font-medium">Charge Master</Link>
                      {" "}and import the hospital&apos;s CDM file (Excel or CSV).
                    </p>
                  </div>
                </div>
              </div>
            )}

            {stats && stats.chargeItems > 0 && stats.totalFindings === 0 && (
              <div className="p-5 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="flex items-center gap-3">
                  <Zap size={20} className="text-amber-600" />
                  <div>
                    <p className="text-sm font-medium text-amber-900">Next step: Run the CDM scan</p>
                    <p className="text-sm text-amber-700 mt-0.5">
                      {stats.chargeItems.toLocaleString()} charge items loaded. Click <strong>Run CDM Scan</strong> above to check them against 14 audit rules.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* KPIs */}
            {stats && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard
                  icon={FileSpreadsheet}
                  label="Charge Items"
                  value={stats.chargeItems.toLocaleString()}
                />
                <KPICard
                  icon={AlertTriangle}
                  label="Open Issues"
                  value={stats.openFindings.toString()}
                  subtext={stats.totalImpact > 0 ? `$${(stats.totalImpact / 1000).toFixed(1)}K est. impact` : undefined}
                />
                <KPICard
                  icon={CheckCircle2}
                  label="Accepted"
                  value={stats.acceptedFindings.toString()}
                  subtext={`${stats.resolvedFindings} resolved`}
                />
                <KPICard
                  icon={Zap}
                  label="Total Findings"
                  value={stats.totalFindings.toString()}
                  subtext={`${stats.rejectedFindings} rejected`}
                />
              </div>
            )}

            {/* Severity Breakdown */}
            {stats && stats.totalFindings > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-xl border border-[#e5e5e0] p-5">
                  <h3 className="text-sm font-semibold text-[#3d3d3a] mb-4">Issues by Severity</h3>
                  <div className="space-y-3">
                    {Object.entries(SEVERITY_CONFIG).filter(([k]) => k !== "info").map(([key, cfg]) => {
                      const count = stats!.severityCounts[key as keyof typeof stats.severityCounts] || 0;
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                          <span className="text-sm text-[#5a5a55] w-16">{cfg.label}</span>
                          <div className="flex-1"><ProgressBar value={count} max={Math.max(stats!.totalFindings, 1)} color={cfg.color} height={6} /></div>
                          <span className="text-sm font-semibold text-[#1a1a18] w-10 text-right">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-[#e5e5e0] p-5">
                  <h3 className="text-sm font-semibold text-[#3d3d3a] mb-4">Review Progress</h3>
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm text-[#7a7a75]">Reviewed</span>
                        <span className="text-sm font-medium text-[#1a1a18]">
                          {stats.acceptedFindings + stats.rejectedFindings + stats.resolvedFindings} / {stats.totalFindings}
                        </span>
                      </div>
                      <ProgressBar
                        value={stats.acceptedFindings + stats.rejectedFindings + stats.resolvedFindings}
                        max={Math.max(stats.totalFindings, 1)}
                        color="#1a1a18"
                        height={8}
                        showLabel
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3 pt-2">
                      <div className="text-center p-3 bg-emerald-50 rounded-xl">
                        <div className="text-lg font-semibold text-emerald-700">{stats.acceptedFindings}</div>
                        <div className="text-xs text-emerald-600">Accepted</div>
                      </div>
                      <div className="text-center p-3 bg-red-50 rounded-xl">
                        <div className="text-lg font-semibold text-red-700">{stats.rejectedFindings}</div>
                        <div className="text-xs text-red-600">Rejected</div>
                      </div>
                      <div className="text-center p-3 bg-purple-50 rounded-xl">
                        <div className="text-lg font-semibold text-purple-700">{stats.resolvedFindings}</div>
                        <div className="text-xs text-purple-600">Resolved</div>
                      </div>
                    </div>
                  </div>
                  <Link href="/findings" className="block mt-4 text-center text-sm text-[#1a1a18] font-medium hover:underline">
                    Review all findings →
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
