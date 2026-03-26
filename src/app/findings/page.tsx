import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClientLib } from "@supabase/supabase-js";
import { Badge, SeverityDot, SEVERITY_CONFIG, ProgressBar, EmptyState } from "@/components/ui/shared";
import { FindingsTable } from "@/components/audit/FindingsTable";
import { AlertTriangle, Zap } from "lucide-react";

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; status?: string; category?: string; page?: string; search?: string }>;
}) {
  const sp = await searchParams;
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

  // Get most recent audit
  const { data: audits } = await supabaseAdmin
    .from("audits")
    .select("id")
    .eq("org_id", userData!.org_id)
    .order("created_at", { ascending: false })
    .limit(1);

  const auditId = audits?.[0]?.id;

  if (!auditId) {
    return (
      <>
        <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center flex-shrink-0">
          <h1 className="text-base font-semibold text-[#1a1a18]">Findings</h1>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <EmptyState icon={AlertTriangle} title="No audit yet" description="Create an audit and run a scan to see findings." />
        </div>
      </>
    );
  }

  // Build query
  const page = parseInt(sp.page || "1");
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from("findings")
    .select("*, charge_items(procedure_number, charge_description, hcpcs_cpt_code, revenue_code, gross_charge)", { count: "exact" })
    .eq("audit_id", auditId)
    .order("severity", { ascending: true })
    .order("created_at", { ascending: false });

  if (sp.severity && sp.severity !== "all") {
    query = query.eq("severity", sp.severity);
  }
  if (sp.status && sp.status !== "all") {
    query = query.eq("status", sp.status);
  }
  if (sp.category && sp.category !== "all") {
    query = query.eq("category", sp.category);
  }
  if (sp.search) {
    query = query.ilike("title", `%${sp.search}%`);
  }

  const { data: findings, count } = await query.range(from, to);
  const totalPages = Math.ceil((count || 0) / pageSize);

  // Get severity counts for summary
  const { data: allFindings } = await supabaseAdmin
    .from("findings")
    .select("severity, status, financial_impact, category")
    .eq("audit_id", auditId);

  const severityCounts = {
    critical: allFindings?.filter((f) => f.severity === "critical").length || 0,
    high: allFindings?.filter((f) => f.severity === "high").length || 0,
    medium: allFindings?.filter((f) => f.severity === "medium").length || 0,
    low: allFindings?.filter((f) => f.severity === "low").length || 0,
    info: allFindings?.filter((f) => f.severity === "info").length || 0,
  };

  const statusCounts = {
    open: allFindings?.filter((f) => f.status === "open").length || 0,
    accepted: allFindings?.filter((f) => f.status === "accepted").length || 0,
    rejected: allFindings?.filter((f) => f.status === "rejected").length || 0,
    resolved: allFindings?.filter((f) => f.status === "resolved").length || 0,
  };

  const totalImpact = allFindings?.reduce((s, f) => s + (f.financial_impact || 0), 0) || 0;

  // Get unique categories
  const categories = [...new Set(allFindings?.map((f) => f.category).filter(Boolean) || [])].sort();

  return (
    <>
      <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#1a1a18]">Findings</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[#9a9a95]">{(count || 0).toLocaleString()} total</span>
          <Badge variant="danger">{statusCounts.open} open</Badge>
          <Badge variant="success">{statusCounts.resolved} resolved</Badge>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {Object.entries(SEVERITY_CONFIG).map(([key, cfg]) => (
              <div key={key} className="bg-white rounded-xl border border-[#e5e5e0] p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                  <span className="text-xs text-[#7a7a75]">{cfg.label}</span>
                </div>
                <div className="text-xl font-semibold text-[#1a1a18]">
                  {severityCounts[key as keyof typeof severityCounts]}
                </div>
              </div>
            ))}
            <div className="bg-white rounded-xl border border-[#e5e5e0] p-4">
              <div className="text-xs text-[#7a7a75] mb-1">Est. Impact</div>
              <div className="text-xl font-semibold text-[#1a1a18]">
                ${totalImpact > 0 ? (totalImpact / 1000).toFixed(1) + "K" : "0"}
              </div>
            </div>
          </div>

          {/* Findings Table */}
          <FindingsTable
            findings={findings || []}
            total={count || 0}
            page={page}
            totalPages={totalPages}
            severityFilter={sp.severity || "all"}
            statusFilter={sp.status || "all"}
            categoryFilter={sp.category || "all"}
            search={sp.search || ""}
            categories={categories}
          />
        </div>
      </div>
    </>
  );
}
