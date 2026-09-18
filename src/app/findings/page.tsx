import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClientLib } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { Badge, SeverityDot, SEVERITY_CONFIG, ProgressBar, EmptyState, formatImpact } from "@/components/ui/shared";
import { FindingsTable } from "@/components/audit/FindingsTable";
import { ReviewPicker } from "@/components/findings/ReviewPicker";
import { PeerAnalysisTab } from "@/components/assessment/AssessmentFlow";
import { bucketForCategory, categoriesInBucket, BUCKET_LABELS, type FindingBucket } from "@/lib/finding-buckets";
import { AlertTriangle, Download } from "lucide-react";

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; status?: string; category?: string; page?: string; search?: string; auditId?: string; tab?: string; tier?: string }>;
}) {
  const sp = await searchParams;
  const TABS: FindingBucket[] = ["cdm", "rvu", "formulary", "peer"];
  const tab: FindingBucket = TABS.includes(sp.tab as FindingBucket) ? (sp.tab as FindingBucket) : "cdm";
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const supabaseAdmin = createAdminClientLib(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { orgId: __org, isPlatformOwner: __owner } = await resolveActiveOrg(supabaseAdmin, user!.id);
  const userData = { org_id: __org, is_platform_owner: __owner };

  // Everyone in a client sees all of that client's findings (department-level
  // gating was removed).

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

  // Get ALL findings (paged) first — drives the summary, the roll-up, and the
  // per-tab bucketing (Supabase caps each response at 1000 rows).
  const allFindings: { severity: string; status: string; financial_impact: number | null; category: string | null; title: string | null }[] = [];
  for (let offset = 0; ; offset += 1000) {
    let statsQuery = supabaseAdmin
      .from("findings")
      .select("severity, status, financial_impact, category, title")
      .eq("audit_id", auditId)
      .eq("ehr_lagging", false)
      .order("id", { ascending: true }); // stable sort so range paging can't repeat rows
    const { data, error } = await statsQuery.range(offset, offset + 999);
    if (error || !data || data.length === 0) break;
    allFindings.push(...data);
    if (data.length < 1000) break;
  }

  // Categories present, and the subset that falls in the active tab's bucket.
  const categories = [...new Set(allFindings.map((f) => f.category).filter((c): c is string => !!c))].sort();
  const bucketCats = categoriesInBucket(categories, tab);

  // Build the paginated table query, scoped to the active tab's categories.
  const page = parseInt(sp.page || "1");
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabaseAdmin
    .from("findings")
    .select("*, charge_items(procedure_number, charge_description, hcpcs_cpt_code, revenue_code, gross_charge)", { count: "exact" })
    .eq("audit_id", auditId)
    .eq("ehr_lagging", false)
    .order("severity", { ascending: true })
    .order("created_at", { ascending: false });
  // Scope the table to the current tab's bucket (peer tab has its own view).
  if (tab !== "peer") query = query.in("category", bucketCats.length ? bucketCats : ["__none__"]);

  if (sp.severity && sp.severity !== "all") {
    query = query.eq("severity", sp.severity);
  }
  if (sp.status && sp.status !== "all") {
    query = query.eq("status", sp.status);
  }
  if (sp.tier && sp.tier !== "all") {
    // A finding with no stored tier is a brand-new (T1) finding.
    if (sp.tier === "1") query = query.or("tier.eq.1,tier.is.null");
    else query = query.eq("tier", Number(sp.tier));
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

  // Summary cards + status counts, scoped to the active bucket, active category
  // filter, and search (not the severity filter, so the breakdown stays useful).
  const scope = allFindings.filter((f) =>
    (tab === "peer" || bucketForCategory(f.category) === tab) &&
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
    in_review: scope.filter((f) => f.status === "in_review").length,
    accepted: scope.filter((f) => f.status === "accepted" || f.status === "resolved").length,
    rejected: scope.filter((f) => f.status === "rejected").length,
    na: scope.filter((f) => f.status === "na").length,
  };

  const totalImpact = scope.reduce((s, f) => s + (f.financial_impact || 0), 0);

  // Lagging EHR: approved in a prior review, re-found now, not yet in the EHR.
  // Shown read-only so the reviewer isn't asked to Accept the same fix again.
  let laggingQuery = supabaseAdmin
    .from("findings")
    .select("id, title, category, resolution_note, financial_impact, charge_items(procedure_number, hcpcs_cpt_code)")
    .eq("audit_id", auditId)
    .eq("ehr_lagging", true)
    .order("category");
  const { data: laggingFindings } = await laggingQuery;
  const lagging = laggingFindings || [];

  // Roll-up: collapse the full flag list into systemic issues by category, ranked
  // by dollar exposure, so the page leads with "what matters" not the raw volume.
  const byCat = new Map<string, { count: number; impact: number }>();
  for (const f of allFindings) {
    if (bucketForCategory(f.category) !== tab) continue; // roll-up follows the active tab
    const c = f.category || "Uncategorized";
    const e = byCat.get(c) || { count: 0, impact: 0 };
    e.count += 1; e.impact += f.financial_impact || 0;
    byCat.set(c, e);
  }
  const rollup = [...byCat.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.impact - a.impact);
  const systemicCount = rollup.length;
  const totalExposure = rollup.reduce((s, r) => s + r.impact, 0);
  const topRollup = rollup.slice(0, 10);

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
          <a href={`/reports?auditId=${auditId}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e293b] text-white text-xs font-semibold hover:bg-[#0f172a]">Report &amp; export</a>
          <a href={`/assessment?auditId=${auditId}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#e2e8f0] text-[#374151] text-xs font-semibold hover:bg-[#f6f7f9]">Open review setup</a>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          {/* Sub-tabs: CDM | RVU | Formulary | Peer Review — each exportable */}
          <div className="flex items-center justify-between gap-3 border-b border-[#e2e8f0]">
            <div className="flex gap-1">
              {TABS.map((t) => (
                <a key={t} href={`/findings?auditId=${auditId}&tab=${t}`} className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === t ? "border-[#1e293b] text-[#1e293b]" : "border-transparent text-[#64748b] hover:text-[#334155]"}`}>{BUCKET_LABELS[t]}</a>
              ))}
            </div>
            {tab !== "peer" && (
              <a href={`/api/findings/export?auditId=${auditId}&bucket=${tab}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 mb-1 rounded-lg bg-white border border-[#e2e8f0] text-[#374151] text-xs font-semibold hover:bg-[#f6f7f9]"><Download size={13} /> Export {BUCKET_LABELS[tab]}</a>
            )}
          </div>

          {tab === "peer" ? <PeerAnalysisTab auditId={auditId!} /> : (<>
          {/* Top findings by impact: roll up the raw flags into systemic issues. */}
          {rollup.length > 0 && (
            <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#eef2f7]">
                <div>
                  <h3 className="text-[13.5px] font-semibold text-[#0f172a]">Top findings by impact</h3>
                  <p className="text-[12px] text-[#64748b] mt-0.5">{systemicCount} systemic {systemicCount === 1 ? "issue" : "issues"} · {allFindings.length.toLocaleString()} total flags · {formatImpact(totalExposure)} estimated exposure</p>
                </div>
                {rollup.length > 10 && <span className="text-[11px] text-[#94a3b8]">Top 10 shown</span>}
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[#94a3b8] border-b border-[#f1f5f9]">
                    <th className="px-5 py-2 w-8">#</th><th className="px-3 py-2">Issue category</th>
                    <th className="px-3 py-2 text-right">Flags</th><th className="px-3 py-2 text-right">Est. impact</th><th className="px-3 py-2 w-16"></th>
                  </tr>
                </thead>
                <tbody>
                  {topRollup.map((r, i) => (
                    <tr key={r.category} className="border-b border-[#f6f8fa] hover:bg-[#f8fafc]">
                      <td className="px-5 py-2.5 text-[#94a3b8]">{i + 1}</td>
                      <td className="px-3 py-2.5 font-medium text-[#0f172a]">{r.category}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#475569]">{r.count.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#0f172a]">{r.impact ? formatImpact(r.impact) : "—"}</td>
                      <td className="px-3 py-2.5 text-right"><a href={`/findings?auditId=${auditId}&category=${encodeURIComponent(r.category)}`} className="text-[12px] text-[#1e293b] hover:underline">View</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pending EHR Sync: approved in a prior review, still not in the EHR. */}
          {lagging.length > 0 && (
            <div className="bg-[#fff8ec] border border-[#f5d99a] rounded-xl p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-[#8a5a1a]" />
                  <h3 className="text-[13.5px] font-semibold text-[#8a5a1a]">Pending EHR Sync · {lagging.length}</h3>
                </div>
                <a href={`/api/change-log/export?auditId=${auditId}`} className="text-[12px] font-semibold text-[#1e293b] hover:underline">Re-export fix file</a>
              </div>
              <p className="text-[12px] text-[#8a5a1a]/90 mb-3">You already reviewed and approved these fixes; they haven't been applied in the EHR yet, so they need no action here.</p>
              <div className="space-y-1.5">
                {lagging.slice(0, 50).map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between gap-3 bg-white/70 rounded-lg px-3 py-2 border border-[#f0e2c2]">
                    <div className="min-w-0">
                      <div className="text-[13px] text-[#0f172a] truncate">{f.title}</div>
                      <div className="text-[11px] text-[#94a3b8]">{f.charge_items ? `${f.charge_items.procedure_number || f.charge_items.hcpcs_cpt_code || "—"} · ` : ""}{f.category}{f.resolution_note ? ` · ${f.resolution_note}` : ""}</div>
                    </div>
                    <span className="text-[10px] font-semibold text-[#8a5a1a] bg-[#fef4e6] px-1.5 py-0.5 rounded shrink-0">AWAITING EHR</span>
                  </div>
                ))}
              </div>
            </div>
          )}

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
            tierFilter={sp.tier || "all"}
            categoryFilter={sp.category || "all"}
            search={sp.search || ""}
            categories={bucketCats}
          />
          </>)}
        </div>
      </div>
    </>
  );
}
