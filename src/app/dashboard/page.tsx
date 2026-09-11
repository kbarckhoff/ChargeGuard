import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClientLib } from "@supabase/supabase-js";
import { Layers, AlertTriangle, Zap, FileSpreadsheet, Upload, DollarSign, ListChecks, Download } from "lucide-react";
import { KPICard, Badge, SeverityBar, ProgressBar, EmptyState, formatImpact } from "@/components/ui/shared";
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
    // Read ALL findings across pages — Supabase caps each response at 1000 rows,
    // so a single select silently undercounts large audits. Page through them.
    const findings: { severity: string; status: string; financial_impact: number | null }[] = [];
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await supabaseAdmin
        .from("findings")
        .select("severity, status, financial_impact")
        .eq("audit_id", audit.id)
        .range(offset, offset + PAGE - 1);
      if (error || !data || data.length === 0) break;
      findings.push(...data);
      if (data.length < PAGE) break;
    }

    const { count: chargeItemsCount } = await supabaseAdmin
      .from("charge_items")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", audit.id);

    stats = {
      chargeItems: chargeItemsCount || 0,
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
      <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#0f172a]">Dashboard</h1>
        <div className="w-8 h-8 rounded-full bg-[#0f172a] flex items-center justify-center text-white text-xs font-medium">
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
            <div>
              <h2 className="text-xl font-semibold text-[#0f172a]">{audit.hospital_name}</h2>
              <p className="text-sm text-[#64748b] mt-0.5">{audit.name}</p>
            </div>

            {/* Scan action + full-width result */}
            <ScanButton auditId={audit.id} />

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
                <KPICard color="blue" icon={FileSpreadsheet} label="Charge lines" value={stats.chargeItems.toLocaleString()} />
                <KPICard color="orange" icon={AlertTriangle} label="Open issues" value={stats.openFindings.toLocaleString()} />
                <KPICard color="green" icon={DollarSign} label="Est. impact" value={formatImpact(stats.totalImpact)} />
                <KPICard color="purple" icon={ListChecks} label="Total findings" value={stats.totalFindings.toLocaleString()} />
              </div>
            )}

            {/* Findings by severity (segmented bar) */}
            {stats && stats.totalFindings > 0 && (
              <div className="bg-white rounded-2xl border border-[#edf0f4] p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-[#111827]">Findings by severity</h3>
                  <Badge variant="default">{stats.openFindings.toLocaleString()} open</Badge>
                </div>
                <SeverityBar counts={stats.severityCounts} />
              </div>
            )}

            {/* Review progress + Reports */}
            {stats && stats.totalFindings > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-[#edf0f4] p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)]">
                  <h3 className="text-sm font-bold text-[#111827] mb-4">Review progress</h3>
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm text-[#64748b]">Reviewed</span>
                        <span className="text-sm font-medium text-[#0f172a]">
                          {stats.acceptedFindings + stats.rejectedFindings + stats.resolvedFindings} / {stats.totalFindings}
                        </span>
                      </div>
                      <ProgressBar
                        value={stats.acceptedFindings + stats.rejectedFindings + stats.resolvedFindings}
                        max={Math.max(stats.totalFindings, 1)}
                        color="#0f172a"
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
                  <Link href="/findings" className="block mt-4 text-center text-sm text-[#2563eb] font-medium hover:underline">
                    Review all findings →
                  </Link>
                </div>

                <div className="bg-white rounded-2xl border border-[#edf0f4] p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_1px_3px_rgba(16,24,40,0.06)]">
                  <h3 className="text-sm font-bold text-[#111827] mb-4">Reports &amp; deliverables</h3>
                  <div className="flex flex-col gap-2.5">
                    <Link href="/reports" className="flex items-center gap-2 px-4 py-2.5 bg-[#2563eb] text-white rounded-lg text-sm font-semibold hover:bg-[#1d4ed8] transition-colors">
                      <Download size={15} /> CDM Analysis Report
                    </Link>
                    <Link href="/reports" className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#e2e6ec] text-[#374151] rounded-lg text-sm font-medium hover:bg-[#f6f7f9] transition-colors">
                      <Download size={15} /> Peer Pricing Analysis
                    </Link>
                    <Link href="/reports" className="flex items-center gap-2 px-4 py-2.5 bg-white border border-[#e2e6ec] text-[#374151] rounded-lg text-sm font-medium hover:bg-[#f6f7f9] transition-colors">
                      <Download size={15} /> Client Data Request
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
