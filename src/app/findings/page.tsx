import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClientLib } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { getActor } from "@/lib/roles";
import { EmptyState, formatImpact } from "@/components/ui/shared";
import { FindingsTable } from "@/components/audit/FindingsTable";
import { RecordTable, type RecordLine } from "@/components/audit/RecordTable";
import { FindingsWorkspace } from "@/components/audit/FindingsWorkspace";
import { ReviewPicker } from "@/components/findings/ReviewPicker";
import { PeerAnalysisTab } from "@/components/assessment/AssessmentFlow";
import { bucketForCategory, categoriesInBucket, BUCKET_LABELS, type FindingBucket } from "@/lib/finding-buckets";
import { classForCategory, categoriesInClass, CLASS_LABELS, CLASS_BLURB, CLASS_COLOR, type FindingClass } from "@/lib/finding-class";
import { AlertTriangle, Download } from "lucide-react";

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; status?: string; category?: string; page?: string; search?: string; auditId?: string; tab?: string; tier?: string; assignee?: string; class?: string; view?: string }>;
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

  // Assignment context: who can assign, the user directory (for the picker and
  // for showing assignee names), and the current user id.
  const actor = await getActor(supabaseAdmin, user!.id);
  const { data: orgUsers } = await supabaseAdmin.from("users").select("id, full_name, email, department, is_active").eq("org_id", userData!.org_id);
  const assignUsers = (orgUsers || []).filter((u: any) => u.is_active).map((u: any) => ({ id: u.id, full_name: u.full_name || u.email, email: u.email, department: u.department || null }));
  const assigneeNames: Record<string, string> = {};
  for (const u of orgUsers || []) assigneeNames[(u as any).id] = (u as any).full_name || (u as any).email;

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

  // View mode: grouped to-dos (default), by CDM line (record), or the full
  // per-finding line list (?view=lines).
  const viewMode = sp.view === "record" ? "record" : sp.view === "lines" ? "lines" : "grouped";

  // Header shared by all modes.
  const headerEl = (
    <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-base font-semibold text-[#0f172a]">Findings &amp; Analysis</h1>
        <ReviewPicker runs={runList} auditId={auditId!} />
      </div>
      <div className="flex items-center gap-3 text-sm">
        <a href={`/api/findings/export?auditId=${auditId}&bucket=all`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#e2e8f0] text-[#374151] text-xs font-semibold hover:bg-[#f6f7f9]"><Download size={13} /> Download all findings</a>
        <a href={`/reports?auditId=${auditId}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e293b] text-white text-xs font-semibold hover:bg-[#0f172a]">Report &amp; export</a>
        <a href={`/assessment?auditId=${auditId}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#e2e8f0] text-[#374151] text-xs font-semibold hover:bg-[#f6f7f9]">Open review setup</a>
      </div>
    </header>
  );

  // GROUPED MODE (default): load the two aggregates once and let a client
  // workspace do all tab/card/category/search/pagination in memory — so those
  // interactions are instant (no server round-trip per click).
  if (viewMode === "grouped") {
    const { data: aggData } = await supabaseAdmin.rpc("findings_rollup", { p_audit: auditId });
    const agg = (Array.isArray(aggData) ? aggData : []).map((r: any) => ({ category: r.category, status: r.status, cnt: Number(r.cnt) || 0, impact: Number(r.impact) || 0 }));
    // Page through all groups (Supabase caps each response at 1000 rows, so a
    // single big range would truncate and undercount the cards).
    const allTodos: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await supabaseAdmin.rpc("findings_todos", { p_audit: auditId }).range(off, off + 999);
      if (error || !Array.isArray(data) || data.length === 0) break;
      allTodos.push(...data);
      if (data.length < 1000) break;
    }
    const todos = allTodos.map((g: any) => ({ grp_key: g.grp_key, category: g.category, code: g.code || "", line_count: Number(g.line_count) || 0, open_count: Number(g.open_count) || 0, impact: Number(g.impact) || 0, sample_title: g.sample_title || "", sample_proc: g.sample_proc || null }));
    const { data: laggingFindings } = await supabaseAdmin.from("findings").select("id, title, category, resolution_note, charge_items(procedure_number, hcpcs_cpt_code)").eq("audit_id", auditId).eq("ehr_lagging", true).order("category");
    return (
      <>
        {headerEl}
        <div className="flex-1 overflow-y-auto p-6">
          <FindingsWorkspace auditId={auditId!} agg={agg} allTodos={todos} lagging={(laggingFindings as any) || []} canAssign={actor.canAssign} users={assignUsers} assigneeNames={assigneeNames} />
        </div>
      </>
    );
  }

  // ── RECORD / LINES MODES (server-rendered) ──────────────────
  // Summary/roll-up data comes from a single grouped aggregate — one row per
  // (category, status) with a count and summed impact — instead of pulling every
  // finding row (a big review has ~18k+ rows, which made every filter change slow).
  type Agg = { category: string | null; status: string | null; cnt: number; impact: number };
  let agg: Agg[] = [];
  const { data: aggData, error: aggErr } = await supabaseAdmin.rpc("findings_rollup", { p_audit: auditId });
  if (!aggErr && Array.isArray(aggData)) {
    agg = (aggData as any[]).map((r) => ({ category: r.category, status: r.status, cnt: Number(r.cnt) || 0, impact: Number(r.impact) || 0 }));
  } else {
    // Fallback for DBs without the findings_rollup function: page through rows
    // and aggregate in memory (slower, but keeps the page working).
    const tmp = new Map<string, Agg>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabaseAdmin
        .from("findings")
        .select("status, financial_impact, category")
        .eq("audit_id", auditId)
        .eq("ehr_lagging", false)
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error || !data || data.length === 0) break;
      for (const f of data as any[]) {
        const k = `${f.category}||${f.status}`;
        const e = tmp.get(k) || { category: f.category, status: f.status, cnt: 0, impact: 0 };
        e.cnt += 1; e.impact += f.financial_impact || 0; tmp.set(k, e);
      }
      if (data.length < 1000) break;
    }
    agg = [...tmp.values()];
  }

  // Categories present, and the subset that falls in the active tab's bucket.
  const categories = [...new Set(agg.map((a) => a.category).filter((c): c is string => !!c))].sort();
  const bucketCats = categoriesInBucket(categories, tab);

  // Fix-type class filter (Code Validity / Pricing / Data Quality / Informational)
  // from clicking a summary card.
  const CLASSES: FindingClass[] = ["code_validity", "pricing", "data_quality", "informational"];
  const activeClass: FindingClass | null = CLASSES.includes(sp.class as FindingClass) ? (sp.class as FindingClass) : null;
  // To-dos = everything in this tab except Informational (SI=Q/B, pass-through,
  // RVU low-volume). The page leads with to-dos; informational is one click (the
  // Informational card) or the full download away.
  const todoCats = bucketCats.filter((c) => classForCategory(c) !== "informational");
  const classCats = activeClass ? categoriesInClass(categories, activeClass).filter((c) => bucketCats.includes(c)) : null;
  // Default view is to-dos only; if a tab is entirely informational (RVU tab),
  // fall back to its items so it isn't blank.
  const defaultCats = todoCats.length ? todoCats : bucketCats;
  const tableCats = classCats ?? defaultCats;

  const lineView = viewMode === "lines";

  const page = parseInt(sp.page || "1");
  const pageSize = 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const selectedCategories = (sp.category && sp.category !== "all")
    ? sp.category.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  // Distinct to-do groups (one per category+code) — drives the cards' to-do
  // counts and the grouped table. One cheap aggregate call.
  let allGroups: any[] = [];
  if (tab !== "peer") {
    // PostgREST caps rpc results at 1000 rows by default; a big review has far
    // more distinct to-dos, so page through them all.
    const todoAll: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await supabaseAdmin.rpc("findings_todos", { p_audit: auditId }).range(off, off + 999);
      if (error || !Array.isArray(data) || data.length === 0) break;
      todoAll.push(...data);
      if (data.length < 1000) break;
    }
    allGroups = todoAll.filter((g) => bucketForCategory(g.category) === tab);
  }

  // Per-finding list (only for ?view=lines).
  let findings: any[] = [];
  let count = 0;
  if (lineView) {
    let query = supabaseAdmin
      .from("findings")
      .select("*, charge_items(procedure_number, charge_description, hcpcs_cpt_code, revenue_code, gross_charge)", { count: "exact" })
      .eq("audit_id", auditId).eq("ehr_lagging", false)
      .order("severity", { ascending: true }).order("created_at", { ascending: false });
    if (tab !== "peer") query = query.in("category", tableCats.length ? tableCats : ["__none__"]);
    if (sp.severity && sp.severity !== "all") query = query.eq("severity", sp.severity);
    if (sp.status && sp.status !== "all") query = query.eq("status", sp.status);
    if (sp.tier && sp.tier !== "all") { if (sp.tier === "1") query = query.or("tier.eq.1,tier.is.null"); else query = query.eq("tier", Number(sp.tier)); }
    if (selectedCategories.length > 0) query = query.in("category", selectedCategories);
    if (sp.search) query = query.ilike("title", `%${sp.search}%`);
    if (sp.assignee && sp.assignee !== "all") { if (sp.assignee === "none") query = query.is("assigned_to", null); else if (sp.assignee === "me") query = query.eq("assigned_to", user!.id); else query = query.eq("assigned_to", sp.assignee); }
    const r = await query.range(from, to);
    findings = r.data || []; count = r.count || 0;
  }

  // By-CDM-line rows: only CDM lines that HAVE an in-scope finding, one row per
  // line, ordered by the line's original file position (record #).
  let recordLines: RecordLine[] = [];
  let recordTotal = 0;
  if (viewMode === "record" && tab !== "peer") {
    const SEV_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
    const rankToSev = (r: number) => (r >= 5 ? "critical" : r >= 4 ? "high" : r >= 3 ? "medium" : r >= 2 ? "low" : r >= 1 ? "info" : null);
    const rows: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await supabaseAdmin
        .from("findings")
        .select("charge_item_id, severity, category, financial_impact, charge_items(source_row, procedure_number, hcpcs_cpt_code, charge_description)")
        .eq("audit_id", auditId).eq("ehr_lagging", false)
        .in("category", tableCats.length ? tableCats : ["__none__"])
        .order("id", { ascending: true }).range(off, off + 999);
      if (error || !data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const q = (sp.search || "").toLowerCase();
    const map = new Map<string, { id: string; rec: number | null; proc: string | null; hcpcs: string | null; desc: string | null; count: number; impact: number; sev: number; cats: Set<string> }>();
    for (const r of rows as any[]) {
      const id = r.charge_item_id; if (!id) continue;
      const ci = r.charge_items || {};
      const e = map.get(id) || { id, rec: ci.source_row ?? null, proc: ci.procedure_number ?? null, hcpcs: ci.hcpcs_cpt_code ?? null, desc: ci.charge_description ?? null, count: 0, impact: 0, sev: 0, cats: new Set<string>() };
      e.count += 1; e.impact += r.financial_impact || 0; e.sev = Math.max(e.sev, SEV_RANK[r.severity] || 0); if (r.category) e.cats.add(r.category);
      map.set(id, e);
    }
    let arr = [...map.values()];
    if (q) arr = arr.filter((l) => (l.proc || "").toLowerCase().includes(q) || (l.hcpcs || "").toLowerCase().includes(q) || (l.desc || "").toLowerCase().includes(q) || String(l.rec ?? "").includes(q));
    arr.sort((a, b) => ((a.rec ?? 1e12) - (b.rec ?? 1e12)) || String(a.proc || "").localeCompare(String(b.proc || "")));
    recordTotal = arr.length;
    recordLines = arr.slice(from, from + pageSize).map((l) => ({
      id: l.id, record_no: l.rec, procedure_number: l.proc, hcpcs_cpt_code: l.hcpcs, charge_description: l.desc,
      issue_count: l.count, worst_sev: rankToSev(l.sev), categories: [...l.cats], impact: l.impact,
    }));
  }

  const totalPages = Math.ceil(((viewMode === "record" ? recordTotal : count) || 0) / pageSize);

  // Summary cards + status counts, scoped to the active bucket and category
  // filter, computed from the aggregate (cheap). Search only narrows the table.
  const scopeAgg = agg.filter((a) =>
    (tab === "peer" || bucketForCategory(a.category) === tab) &&
    (selectedCategories.length === 0 || (a.category != null && selectedCategories.includes(a.category)))
  );

  const totalImpact = scopeAgg.reduce((s, a) => s + a.impact, 0);

  // Fix-type class breakdown. Cards show distinct TO-DO counts (from the grouped
  // aggregate), not raw flags. Fall back to flag counts if the to-do function
  // isn't available yet (pre-migration).
  const classCounts: Record<FindingClass, number> = { code_validity: 0, pricing: 0, data_quality: 0, informational: 0 };
  for (const a of scopeAgg) classCounts[classForCategory(a.category)] += a.cnt;
  const classToDoCounts: Record<FindingClass, number> = { code_validity: 0, pricing: 0, data_quality: 0, informational: 0 };
  for (const g of allGroups) {
    if (selectedCategories.length && !selectedCategories.includes(g.category)) continue;
    classToDoCounts[classForCategory(g.category)] += 1;
  }
  const cardCounts = allGroups.length > 0 ? classToDoCounts : classCounts;

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
  for (const a of agg) {
    if (bucketForCategory(a.category) !== tab) continue; // roll-up follows the active tab
    // Lead with actionable to-dos; drop informational unless the tab is all-info.
    if (todoCats.length && classForCategory(a.category) === "informational") continue;
    const c = a.category || "Uncategorized";
    const e = byCat.get(c) || { count: 0, impact: 0 };
    e.count += a.cnt; e.impact += a.impact;
    byCat.set(c, e);
  }
  const rollup = [...byCat.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.impact - a.impact);
  const systemicCount = rollup.length;
  const totalExposure = rollup.reduce((s, r) => s + r.impact, 0);
  // Headline flag count = the actionable flags in the roll-up (this tab, minus
  // informational), so it matches the table beneath it rather than counting every
  // flag across all tabs.
  const rollupTotal = rollup.reduce((s, r) => s + r.count, 0);
  const topRollup = rollup.slice(0, 10);

  return (
    <>
      <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-[#0f172a]">Findings &amp; Analysis</h1>
          <ReviewPicker runs={runList} auditId={auditId!} />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <a href={`/api/findings/export?auditId=${auditId}&bucket=all`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#e2e8f0] text-[#374151] text-xs font-semibold hover:bg-[#f6f7f9]"><Download size={13} /> Download all findings</a>
          <a href={`/reports?auditId=${auditId}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1e293b] text-white text-xs font-semibold hover:bg-[#0f172a]">Report &amp; export</a>
          <a href={`/assessment?auditId=${auditId}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-[#e2e8f0] text-[#374151] text-xs font-semibold hover:bg-[#f6f7f9]">Open review setup</a>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-4">
          {/* Sub-tabs: CDM | RVU | Formulary | Peer Review */}
          <div className="flex items-center gap-3 border-b border-[#e2e8f0]">
            <div className="flex gap-1">
              {TABS.map((t) => (
                <a key={t} href={`/findings?auditId=${auditId}&tab=${t}`} className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === t ? "border-[#1e293b] text-[#1e293b]" : "border-transparent text-[#64748b] hover:text-[#334155]"}`}>{BUCKET_LABELS[t]}</a>
              ))}
            </div>
          </div>

          {tab === "peer" ? <PeerAnalysisTab auditId={auditId!} /> : (<>
          {/* Top findings by impact: roll up the raw flags into systemic issues. */}
          {rollup.length > 0 && (
            <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#eef2f7]">
                <div>
                  <h3 className="text-[13.5px] font-semibold text-[#0f172a]">Top findings by impact</h3>
                  <p className="text-[12px] text-[#64748b] mt-0.5">{systemicCount} systemic {systemicCount === 1 ? "issue" : "issues"} · {rollupTotal.toLocaleString()} flags to fix · {formatImpact(totalExposure)} estimated exposure</p>
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

          {/* Summary Cards — by fix type, so quick coding fixes are separable
              from the pricing bulk. Click a card to filter the table. */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {(["code_validity", "pricing", "data_quality", "informational"] as FindingClass[]).map((cls) => {
              const active = activeClass === cls;
              const href = active
                ? `/findings?auditId=${auditId}&tab=${tab}`
                : `/findings?auditId=${auditId}&tab=${tab}&class=${cls}`;
              return (
                <a key={cls} href={href}
                  className={`bg-white rounded-xl border p-4 transition-colors ${active ? "border-[#1e293b] ring-1 ring-[#1e293b]" : "border-[#e2e8f0] hover:border-[#cbd5e1]"}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CLASS_COLOR[cls] }} />
                    <span className="text-xs font-medium text-[#334155]">{CLASS_LABELS[cls]}</span>
                  </div>
                  <div className="text-xl font-semibold text-[#0f172a]">{cardCounts[cls].toLocaleString()}</div>
                  <div className="text-[11px] text-[#94a3b8] mt-0.5">{CLASS_BLURB[cls]}</div>
                </a>
              );
            })}
            <div className="bg-white rounded-xl border border-[#e2e8f0] p-4">
              <div className="text-xs text-[#64748b] mb-1">Est. Impact</div>
              <div className="text-xl font-semibold text-[#0f172a]">{formatImpact(totalImpact)}</div>
              {activeClass && <div className="text-[11px] text-[#94a3b8] mt-0.5">Filtered: {CLASS_LABELS[activeClass]}</div>}
            </div>
          </div>

          {/* View toggle: grouped to-dos vs one row per CDM line */}
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[#64748b]">View:</span>
            {([["grouped", "Grouped to-dos"], ["record", "By CDM line"]] as [string, string][]).map(([v, label]) => {
              const on = viewMode === v || (v === "grouped" && viewMode === "lines");
              const href = `/findings?auditId=${auditId}&tab=${tab}${activeClass ? `&class=${activeClass}` : ""}${v === "record" ? "&view=record" : ""}`;
              return (
                <a key={v} href={href} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ${on ? "bg-[#1e293b] text-white border-[#1e293b]" : "bg-white text-[#475569] border-[#e2e8f0] hover:bg-[#f6f7f9]"}`}>{label}</a>
              );
            })}
          </div>

          {viewMode === "record" ? (
            <RecordTable
              lines={recordLines}
              total={recordTotal}
              page={page}
              totalPages={totalPages}
              search={sp.search || ""}
              canAssign={actor.canAssign}
              users={assignUsers}
              assigneeNames={assigneeNames}
              scopeCats={tableCats}
            />
          ) : lineView ? (
            <>
              <div className="flex items-center justify-between">
                <a href={`/findings?auditId=${auditId}&tab=${tab}${activeClass ? `&class=${activeClass}` : ""}`} className="text-[13px] text-[#1e293b] hover:underline">&larr; Back to to-dos</a>
                <span className="text-[12px] text-[#94a3b8]">Line-by-line (per finding)</span>
              </div>
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
                canAssign={actor.canAssign}
                currentUserId={user!.id}
                users={assignUsers}
                assigneeNames={assigneeNames}
                assigneeFilter={sp.assignee || "all"}
              />
            </>
          ) : null}
          </>)}
        </div>
      </div>
    </>
  );
}
