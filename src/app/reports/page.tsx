import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClientLib } from "@supabase/supabase-js";
import { Badge, EmptyState, SEVERITY_CONFIG } from "@/components/ui/shared";
import { PieChart, AlertTriangle } from "lucide-react";
import { ExportForm } from "@/components/reports/ExportForm";

export default async function ReportsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const supabaseAdmin = createAdminClientLib(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: userData } = await supabaseAdmin
    .from("users")
    .select("org_id")
    .eq("id", user!.id)
    .single();

  const { data: audits } = await supabaseAdmin
    .from("audits")
    .select("id, hospital_name, name")
    .eq("org_id", userData!.org_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const audit = audits?.[0];

  if (!audit) {
    return (
      <>
        <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center flex-shrink-0">
          <h1 className="text-base font-semibold text-[#1a1a18]">Reports</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyState icon={PieChart} title="No audit yet" description="Create an audit and run a scan to generate reports." />
        </div>
      </>
    );
  }

  // Get finding stats for the summary
  const { data: findings } = await supabaseAdmin
    .from("findings")
    .select("severity, status, category, financial_impact")
    .eq("audit_id", audit.id);

  const total = findings?.length || 0;
  const open = findings?.filter((f) => f.status === "open").length || 0;
  const accepted = findings?.filter((f) => f.status === "accepted").length || 0;
  const resolved = findings?.filter((f) => f.status === "resolved").length || 0;
  const rejected = findings?.filter((f) => f.status === "rejected").length || 0;
  const totalImpact = findings?.reduce((s, f) => s + (f.financial_impact || 0), 0) || 0;
  const categories = [...new Set(findings?.map((f) => f.category).filter(Boolean) || [])].sort();

  return (
    <>
      <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center flex-shrink-0">
        <h1 className="text-base font-semibold text-[#1a1a18]">Reports</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Summary */}
          <div className="bg-white rounded-xl border border-[#e5e5e0] p-5">
            <h3 className="text-sm font-semibold text-[#3d3d3a] mb-1">{audit.hospital_name}</h3>
            <p className="text-sm text-[#7a7a75] mb-4">{audit.name}</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="p-3 bg-[#f5f5f0] rounded-xl text-center">
                <div className="text-lg font-semibold text-[#1a1a18]">{total}</div>
                <div className="text-xs text-[#7a7a75]">Total</div>
              </div>
              <div className="p-3 bg-amber-50 rounded-xl text-center">
                <div className="text-lg font-semibold text-amber-700">{open}</div>
                <div className="text-xs text-amber-600">Open</div>
              </div>
              <div className="p-3 bg-emerald-50 rounded-xl text-center">
                <div className="text-lg font-semibold text-emerald-700">{accepted}</div>
                <div className="text-xs text-emerald-600">Accepted</div>
              </div>
              <div className="p-3 bg-red-50 rounded-xl text-center">
                <div className="text-lg font-semibold text-red-700">{rejected}</div>
                <div className="text-xs text-red-600">Rejected</div>
              </div>
              <div className="p-3 bg-purple-50 rounded-xl text-center">
                <div className="text-lg font-semibold text-purple-700">{resolved}</div>
                <div className="text-xs text-purple-600">Resolved</div>
              </div>
            </div>
            {totalImpact > 0 && (
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                <span className="text-sm text-amber-800">Total Estimated Financial Impact</span>
                <span className="text-lg font-semibold text-amber-900">${(totalImpact / 1000).toFixed(1)}K</span>
              </div>
            )}
          </div>

          {/* Export Form */}
          <ExportForm auditId={audit.id} categories={categories} totalFindings={total} />
        </div>
      </div>
    </>
  );
}
