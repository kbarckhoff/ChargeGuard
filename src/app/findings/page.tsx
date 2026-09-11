import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClientLib } from "@supabase/supabase-js";
import { Badge, SeverityDot, SEVERITY_CONFIG, ProgressBar, EmptyState, formatImpact } from "@/components/ui/shared";
import { FindingsTable } from "@/components/audit/FindingsTable";
import { ReviewPicker } from "@/components/findings/ReviewPicker";
import { PeerAnalysisTab } from "@/components/assessment/AssessmentFlow";
import { AlertTriangle, Zap } from "lucide-react";

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; status?: string; category?: string; page?: string; search?: string; auditId?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === "peer" ? "peer" : "findings";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const supabaseAdmin = createAdminClientLib(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { data: userData } = await supabaseAdmin
    .from("users")
    .select("org_id, is_platform_owner")
    .eq("id", user!.id)
    .single();

  // Department gating: a user sees only findings for the departments they belong
  // to. The platform owner, or a user who belongs to every department, sees all.
  const [{ data: myDepts }, { count: orgDeptCount }] = await Promise.all([
    supabaseAdmin.from("user_departments").select("department_id").eq("user_id", user!.id),
    supabaseAdmin.from("departments").select("id", { count: "exact", head: true }).eq("org_id", userData!.org_id).eq("is_active", true),
  ]);
  const myDeptIds = (myDepts || []).map((d) => (d as any).department_id as string);
  const canSeeAll = !!userData?.is_platform_owner || (orgDeptCount != null && orgDeptCount > 0 && myDeptIds.length >= orgDeptCount);
  // When scoped, filter to the user's departments (empty set -> match nothing).
  const scopeIds = myDeptIds.length ? myDeptIds : ["00000000-0000-0000-0000-000000000000"];

  // Scope to a specific run when ?auditId is passed (from inside a run);
  // otherwise fall back to the most recent audit.
  let auditId = sp.auditId;
  if (auditId) {
    const { data: check } = await supabaseAdmin
      .from("audits").select("id").eq("id", auditId).eq("org_id", userData!.org_id).single();
    if (!check) auditId = undefined;
  }
  if (!auditId) {
    const { data: audits } = await supabaseAdmin
      .from("audits")
      .select("id")
      .eq("org_id", userData!.org_id)
      .order("created_at", { ascending: false })
      .limit(1);
    auditId = audits?.[0]?.id;
  }

  // Review list for the header picker (switch which review's findings to view).
  const { data: runListRaw } = await supabaseAdmin
    .from("audits").select("id, name").eq("org_id", userData!.org_id).order("created_at", { ascending: false });
  const runList = (runListRaw || []).map((r) => ({ id: r.id as string, name: (r.name as string) || "Untitled review" }));

  if (!auditId) {
    return (
      <>
        <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center flex-shrink-0">
          <h1 className="text-base font-semibold text-[#0f172a]">Findings</h1>
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
  if (!canSeeAll) query = query.in("owner_department_id", scopeIds);

  if (sp.severity && sp.severity !== "all") {
    query = query.eq("severity", sp.severity);
  }
  if (sp.status && sp.status !== "all") {
    query = query.eq("status", sp.status);
  }
  const selectedCategories = (sp.category && sp.category !== "all")
    ? sp.category.split(",").map((c) => c.trim()).filter(Boolean)
    : [];
  if (selectedCategories.length > 0) {
    query = query.in("category", selectedCategories);
  }
  if (sp.search) {
    query = query.ilike("title", `%${sp.search}%`);
  }

  const { data: findings, count } = await query.range(from, to);
  const totalPages = Math.ceil((count || 0) / pageSize);

  // Get severity counts for summary — page through ALL findings (Supabase caps
  // each response at 1000 rows, which otherwise undercounts stats and drops
  // categories from the filter dropdown).
  const allFindings: { severity: string; status: string; financial_impact: number | null; category: string | null; title: string | null }[] = [];
  for (let offset = 0; ; offset += 1000) {
    let statsQuery = supabaseAdmin
      .from("findings")
      .select("severity, status, financial_impact, category, title")
      .eq("audit_id", auditId);
    if (!canSeeAll) statsQuery = statsQuery.in("owner_department_id", scopeIds);
    const { data, error } = await statsQuery.range(offset, offset + 999);
    if (error || !data || data.length === 0) break;
    allFindings.push(...data);
    if (data.length < 1000) break;
  }

  // Summary cards reflect the active category/search filter (but not the severity
  // filter, so the severity breakdown stays meaningful). The category dropdown
  // still lists every category (built from the full set below).
  const scope = allFindings.filter((f) =>
    (selectedCategories.length === 0 || (f.category != null && selectedCategories.includes(f.category))) &&
    (!sp.search || (f.title || "").toLowerCase().includes(sp.search.toLowerCase()))
  );

  const severityCounts = {
    critical: scope.filter((f) => f.severity === "critical").length,
    high: scope.filter((f) => f.severity === "high").length,
    medium: scope.filter((f) => f.severity === "medium").length,
    low: scope.filter((f) => f.severity === "low").length,
    info: scope.filter((f) => f.severity === "info").length,
  };

  const statusCounts = {
    open: scope.filter((f) => f.status === "open").length,
    accepted: scope.filter((f) => f.status === "accepted").length,
    rejected: scope.filter((f) => f.status === "rejected").length,
    resolved: scope.filter((f) => f.status === "resolved").length,
  };

  const totalImpact = scope.reduce((s, f) => s + (f.financial_impact || 0), 0);

  // Get unique categories
  const categories = [...new Set(allFindings.map((f) => f.category).filter((c): c is string => !!c))].sort();

  return (
    <>
      <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-[#0f172a]">Findings &amp; Analysis</h1>
          <ReviewPicker runs={runList} auditId={auditId!} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-[#94a3b8]">{(count || 0).toLocaleString()} total</span>
          <Badge variant="danger">{statusCounts.open} open</Badge>
          <a href={`/reports?auditId=${auditId}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#2563eb] text-white text-xs font-semibold hover:bg-[#1d4ed8]">Report &amp; export</a>
          <a href={`/assessment?auditId=${auditId}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#e2e8f0] text-[#374151] text-xs font-semibold hover:bg-[#f6f7f9]">Open review setup</a>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          {/* Sub-tabs: Findings | Peer Analysis */}
          <div className="flex gap-1 border-b border-[#e2e8f0]">
            <a href={`/findings?auditId=${auditId}`} className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === "findings" ? "border-[#2563eb] text-[#2563eb]" : "border-transparent text-[#64748b] hover:text-[#334155]"}`}>Rule Findings</a>
            <a href={`/findings?auditId=${auditId}&tab=peer`} className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === "peer" ? "border-[#2563eb] text-[#2563eb]" : "border-transparent text-[#64748b] hover:text-[#334155]"}`}>Peer Review Analysis</a>
          </div>

          {tab === "peer" ? <PeerAnalysisTab auditId={auditId!} /> : (<>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            {Object.entries(SEVERITY_CONFIG).map(([key, cfg]) => (
              <div key={key} className="bg-white rounded-xl border border-[#e2e8f0] p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                  <span className="text-xs text-[#64748b]">{cfg.label}</span>
                </div>
                <div className="text-xl font-semibold text-[#0f172a]">
                  {severityCounts[key as keyof typeof severityCounts]}
                </div>
              </div>
            ))}
            <div className="bg-white rounded-xl border border-[#e2e8f0] p-4">
              <div className="text-xs text-[#64748b] mb-1">Est. Impact</div>
              <div className="text-xl font-semibold text-[#0f172a]">
                {formatImpact(totalImpact)}
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
          </>)}
        </div>
      </div>
    </>
  );
}
