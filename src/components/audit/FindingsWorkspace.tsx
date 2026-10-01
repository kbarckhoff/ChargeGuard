"use client";

import { useMemo, useState } from "react";
import { Badge, formatImpact } from "@/components/ui/shared";
import { bucketForCategory, categoriesInBucket, BUCKET_LABELS, type FindingBucket } from "@/lib/finding-buckets";
import { classForCategory, categoriesInClass, CLASS_LABELS, CLASS_BLURB, CLASS_COLOR, type FindingClass } from "@/lib/finding-class";
import { PeerAnalysisTab } from "@/components/assessment/AssessmentFlow";
import { FindingDrawer, type FindingRow } from "@/components/audit/FindingsTable";
import { Search, ChevronRight, ChevronDown, Loader2, Check, X, MinusCircle, AlertTriangle, LayoutGrid, List } from "lucide-react";

type Agg = { category: string | null; status: string | null; cnt: number; impact: number };
type TodoGroup = { grp_key: string; category: string; code: string; line_count: number; open_count: number; impact: number; sample_title: string; sample_proc: string | null };
type Lagging = { id: string; title: string; category: string; resolution_note: string | null; charge_items: { procedure_number: string; hcpcs_cpt_code: string } | null };
type LineRow = { id: string; n: number; max: number; category: string; proc: string | null; hcpcs: string | null; desc: string | null; gross: number | null };

// Issue-count buckets for the per-line distribution band.
type LineBucket = "1-2" | "3-4" | "5+";
const inLineBucket = (n: number, b: LineBucket) => b === "1-2" ? n <= 2 : b === "3-4" ? n >= 3 && n <= 4 : n >= 5;

const TABS: FindingBucket[] = ["cdm", "rvu", "formulary", "peer"];
const CLASSES: FindingClass[] = ["code_validity", "pricing", "data_quality", "informational"];
const PAGE_SIZE = 50;

const STATUS_LABEL: Record<string, string> = { open: "Open", in_review: "Under Review", accepted: "Accepted", rejected: "Denied", na: "N/A", resolved: "Accepted" };
const statusVariant = (s: string): any => s === "accepted" || s === "resolved" ? "success" : s === "rejected" ? "danger" : s === "in_review" ? "purple" : s === "na" ? "default" : "default";

export function FindingsWorkspace({
  auditId, agg, allTodos, lagging, lineRollup = [], totalLines = 0, canAssign = false, users = [], assigneeNames = {},
}: {
  auditId: string;
  agg: Agg[];
  allTodos: TodoGroup[];
  lagging: Lagging[];
  lineRollup?: LineRow[];
  totalLines?: number;
  canAssign?: boolean;
  users?: { id: string; full_name: string; email: string; department: string | null }[];
  assigneeNames?: Record<string, string>;
}) {
  const [tab, setTab] = useState<FindingBucket>("cdm");
  const [activeClass, setActiveClass] = useState<FindingClass | null>(null);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  // Per-line card view (vs the grouped to-do table) + issue-count bucket filter.
  const [lineView, setLineView] = useState(false);
  const [lineBucket, setLineBucket] = useState<LineBucket | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [lineFindings, setLineFindings] = useState<Record<string, FindingRow[]>>({});
  const [loadingLine, setLoadingLine] = useState<string | null>(null);

  // Group disposition (applied locally so the list updates without a reload).
  const [disp, setDisp] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, any[]>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<FindingRow | null>(null);
  const [rollupOpen, setRollupOpen] = useState(false); // Top-findings roll-up starts collapsed.

  const reset = (t: FindingBucket) => { setTab(t); setActiveClass(null); setSelectedCats([]); setSearch(""); setPage(1); setLineBucket(null); };

  // Everything derives from the two aggregates in memory — no server round-trips.
  const categories = useMemo(() => [...new Set(agg.map((a) => a.category).filter((c): c is string => !!c))].sort(), [agg]);
  const bucketCats = useMemo(() => categoriesInBucket(categories, tab), [categories, tab]);
  const todoCats = useMemo(() => bucketCats.filter((c) => classForCategory(c) !== "informational"), [bucketCats]);

  // Card counts = distinct to-dos per class within the active tab.
  const classCounts = useMemo(() => {
    const c: Record<FindingClass, number> = { code_validity: 0, pricing: 0, data_quality: 0, informational: 0 };
    for (const g of allTodos) if (bucketForCategory(g.category) === tab) c[classForCategory(g.category)] += 1;
    return c;
  }, [allTodos, tab]);

  // Impact, deduped to max-per-line: each CDM line contributes only its single
  // largest finding's dollar impact, so a line flagged by several rules is not
  // double-counted. Lines are bucketed by their dominant (largest) finding's
  // category. `tabDedupImpact` is the tab total; `dedupImpact` also honours the
  // active class + category filters (what the Est. Impact card reflects).
  // When the per-line rollup RPC isn't available yet (migration not run), fall
  // back to the old summed aggregate so impact never shows $0.
  const hasLineData = lineRollup.length > 0;
  const tabLines = useMemo(() => lineRollup.filter((l) => bucketForCategory(l.category) === tab), [lineRollup, tab]);
  const summedTabImpact = useMemo(() => agg.filter((a) => bucketForCategory(a.category) === tab).reduce((s, a) => s + a.impact, 0), [agg, tab]);
  const tabDedupImpact = useMemo(() => hasLineData ? tabLines.reduce((s, l) => s + (l.max || 0), 0) : summedTabImpact, [hasLineData, tabLines, summedTabImpact]);
  const dedupImpact = useMemo(() => {
    if (!hasLineData) return summedTabImpact;
    const classCats = activeClass ? categoriesInClass(categories, activeClass) : null;
    return tabLines
      .filter((l) => !classCats || classCats.includes(l.category))
      .filter((l) => selectedCats.length === 0 || selectedCats.includes(l.category))
      .reduce((s, l) => s + (l.max || 0), 0);
  }, [hasLineData, summedTabImpact, tabLines, activeClass, categories, selectedCats]);
  const totalImpact = dedupImpact;

  // Issue-count distribution across ALL CDM lines in the review (not tab-scoped),
  // so the reviewer sees how concentrated the problems are: clean lines vs lines
  // carrying 1-2, 3-4, or 5+ separate issues.
  const dist = useMemo(() => {
    let oneTwo = 0, threeFour = 0, fivePlus = 0;
    for (const l of lineRollup) { if (l.n <= 2) oneTwo++; else if (l.n <= 4) threeFour++; else fivePlus++; }
    const flagged = lineRollup.length;
    const clean = Math.max(0, totalLines - flagged);
    return { clean, oneTwo, threeFour, fivePlus, flagged };
  }, [lineRollup, totalLines]);

  // Lines for the card grid: review-wide, filtered by class/category/search and
  // the selected issue-count bucket. Sorted by dollar impact, then issue count.
  const filteredLines = useMemo(() => {
    const classCats = activeClass ? categoriesInClass(categories, activeClass) : null;
    const q = search.trim().toLowerCase();
    return lineRollup
      .filter((l) => !classCats || classCats.includes(l.category))
      .filter((l) => selectedCats.length === 0 || selectedCats.includes(l.category))
      .filter((l) => !lineBucket || inLineBucket(l.n, lineBucket))
      .filter((l) => !q || (l.proc || "").toLowerCase().includes(q) || (l.hcpcs || "").toLowerCase().includes(q) || (l.desc || "").toLowerCase().includes(q))
      .sort((a, b) => (b.max - a.max) || (b.n - a.n));
  }, [lineRollup, activeClass, categories, selectedCats, lineBucket, search]);

  // Roll-up (actionable categories by impact) for the active tab.
  const rollup = useMemo(() => {
    const byCat = new Map<string, { count: number; impact: number }>();
    for (const a of agg) {
      if (bucketForCategory(a.category) !== tab) continue;
      if (todoCats.length && classForCategory(a.category) === "informational") continue;
      const k = a.category || "Uncategorized";
      const e = byCat.get(k) || { count: 0, impact: 0 };
      e.count += a.cnt; e.impact += a.impact; byCat.set(k, e);
    }
    return [...byCat.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.impact - a.impact);
  }, [agg, tab, todoCats]);
  // Headline flag count = the actionable flags shown in the roll-up below (this
  // tab, excluding informational), so the number matches the table. Informational
  // context (SI=Q/B, RVU, shoppable) is surfaced in its own card, not counted here.
  const rollupTotal = useMemo(() => rollup.reduce((s, r) => s + r.count, 0), [rollup]);

  // Filtered + sorted grouped rows for the table (client-side, instant).
  const filteredGroups = useMemo(() => {
    const classCats = activeClass ? categoriesInClass(categories, activeClass).filter((c) => bucketCats.includes(c)) : null;
    const scope = classCats ?? (todoCats.length ? todoCats : bucketCats);
    const q = search.trim().toLowerCase();
    return allTodos
      .filter((g) => bucketForCategory(g.category) === tab)
      .filter((g) => scope.includes(g.category))
      .filter((g) => selectedCats.length === 0 || selectedCats.includes(g.category))
      .filter((g) => !q || (g.code || "").toLowerCase().includes(q) || (g.sample_title || "").toLowerCase().includes(q))
      .sort((a, b) => (b.impact - a.impact) || (b.line_count - a.line_count));
  }, [allTodos, tab, activeClass, categories, bucketCats, todoCats, selectedCats, search]);

  const totalPages = Math.max(1, Math.ceil(filteredGroups.length / PAGE_SIZE));
  const pageGroups = filteredGroups.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE);

  const disposition = async (g: TodoGroup, status: string) => {
    setBusyKey(g.grp_key);
    try {
      await fetch("/api/findings/disposition-group", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId, grpKey: g.grp_key, status }) });
      setDisp((p) => ({ ...p, [g.grp_key]: status }));
    } catch { /* ignore */ } finally { setBusyKey(null); }
  };
  const toggleExpand = async (g: TodoGroup) => {
    if (openKey === g.grp_key) { setOpenKey(null); return; }
    setOpenKey(g.grp_key);
    if (!lines[g.grp_key]) {
      setLoadingKey(g.grp_key);
      try {
        const catsParam = `&cats=${encodeURIComponent((activeClass ? categoriesInClass(categories, activeClass).filter((c) => bucketCats.includes(c)) : todoCats).join("|"))}`;
        const r = await fetch(`/api/findings/group-lines?auditId=${auditId}&grpKey=${encodeURIComponent(g.grp_key)}${catsParam}`);
        const d = await r.json();
        setLines((p) => ({ ...p, [g.grp_key]: d.lines || [] }));
      } catch { /* ignore */ } finally { setLoadingKey(null); }
    }
  };

  // Expand a line card to list its individual findings (scoped to the active tab's
  // categories), each opening the detail drawer.
  const toggleLine = async (l: LineRow) => {
    if (openLine === l.id) { setOpenLine(null); return; }
    setOpenLine(l.id);
    if (!lineFindings[l.id]) {
      setLoadingLine(l.id);
      try {
        const r = await fetch(`/api/findings/by-line?lineId=${encodeURIComponent(l.id)}`);
        const d = await r.json();
        setLineFindings((p) => ({ ...p, [l.id]: d.lines || [] }));
      } catch { /* ignore */ } finally { setLoadingLine(null); }
    }
  };
  const pickBucket = (b: LineBucket) => { setLineBucket((cur) => cur === b ? null : b); setLineView(true); setPage(1); };

  const linePages = Math.max(1, Math.ceil(filteredLines.length / PAGE_SIZE));
  const pageLines = filteredLines.slice((page - 1) * PAGE_SIZE, (page - 1) * PAGE_SIZE + PAGE_SIZE);

  const qs = (view: string) => `/findings?auditId=${auditId}&tab=${tab}${activeClass ? `&class=${activeClass}` : ""}&view=${view}`;

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Tabs (instant) */}
      <div className="flex items-center gap-3 border-b border-[#e2e8f0]">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => reset(t)} className={`px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px ${tab === t ? "border-[#1e293b] text-[#1e293b]" : "border-transparent text-[#64748b] hover:text-[#334155]"}`}>{BUCKET_LABELS[t]}</button>
          ))}
        </div>
      </div>

      {tab === "peer" ? <PeerAnalysisTab auditId={auditId} /> : (<>
        {/* Roll-up */}
        {rollup.length > 0 && (
          <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
            <button onClick={() => setRollupOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-[#f8fafc]">
              <div>
                <h3 className="text-[13.5px] font-semibold text-[#0f172a]">Top findings by impact</h3>
                <p className="text-[12px] text-[#64748b] mt-0.5">{rollup.length} systemic {rollup.length === 1 ? "issue" : "issues"} · {rollupTotal.toLocaleString()} flags to fix · {formatImpact(tabDedupImpact)} estimated exposure{hasLineData && <span className="text-[#b9c0ca]"> (deduped per line)</span>}</p>
              </div>
              <span className="flex items-center gap-1.5 text-[11px] text-[#94a3b8] shrink-0">Top {Math.min(10, rollup.length)} shown <ChevronDown size={14} className={`transition-transform ${rollupOpen ? "rotate-180" : ""}`} /></span>
            </button>
            {rollupOpen && (
            <table className="w-full text-[13px] border-t border-[#eef2f7]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#94a3b8] border-b border-[#f1f5f9]">
                  <th className="px-5 py-2 w-8">#</th><th className="px-3 py-2">Issue category</th>
                  <th className="px-3 py-2 text-right">Flags</th><th className="px-3 py-2 text-right">Est. impact</th><th className="px-3 py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {rollup.slice(0, 10).map((r, i) => (
                  <tr key={r.category} className="border-b border-[#f6f8fa] hover:bg-[#f8fafc]">
                    <td className="px-5 py-2.5 text-[#94a3b8]">{i + 1}</td>
                    <td className="px-3 py-2.5 font-medium text-[#0f172a]">{r.category}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#475569]">{r.count.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#0f172a]">{r.impact ? formatImpact(r.impact) : "—"}</td>
                    <td className="px-3 py-2.5 text-right"><button onClick={() => { setSelectedCats([r.category]); setPage(1); }} className="text-[12px] text-[#1e293b] hover:underline">View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </div>
        )}

        {/* Pending EHR sync (CDM tab) */}
        {tab === "cdm" && lagging.length > 0 && (
          <div className="bg-[#fff8ec] border border-[#f5d99a] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2"><AlertTriangle size={16} className="text-[#8a5a1a]" /><h3 className="text-[13.5px] font-semibold text-[#8a5a1a]">Pending EHR Sync · {lagging.length}</h3></div>
            <p className="text-[12px] text-[#8a5a1a]/90 mb-3">Already reviewed and approved; not yet applied in the EHR, so no action needed here.</p>
            <div className="space-y-1.5">
              {lagging.slice(0, 50).map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 bg-white/70 rounded-lg px-3 py-2 border border-[#f0e2c2]">
                  <div className="min-w-0"><div className="text-[13px] text-[#0f172a] truncate">{f.title}</div><div className="text-[11px] text-[#94a3b8]">{f.charge_items ? `${f.charge_items.procedure_number || f.charge_items.hcpcs_cpt_code || "—"} · ` : ""}{f.category}</div></div>
                  <span className="text-[10px] font-semibold text-[#8a5a1a] bg-[#fef4e6] px-1.5 py-0.5 rounded shrink-0">AWAITING EHR</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cards (instant filter) */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {CLASSES.map((cls) => {
            const on = activeClass === cls;
            return (
              <button key={cls} onClick={() => { setActiveClass(on ? null : cls); setPage(1); }} className={`text-left bg-white rounded-xl border p-4 transition-colors ${on ? "border-[#1e293b] ring-1 ring-[#1e293b]" : "border-[#e2e8f0] hover:border-[#cbd5e1]"}`}>
                <div className="flex items-center gap-2 mb-1"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CLASS_COLOR[cls] }} /><span className="text-xs font-medium text-[#334155]">{CLASS_LABELS[cls]}</span></div>
                <div className="text-xl font-semibold text-[#0f172a]">{classCounts[cls].toLocaleString()}</div>
                <div className="text-[11px] text-[#94a3b8] mt-0.5">{CLASS_BLURB[cls]}</div>
              </button>
            );
          })}
          <div className="bg-white rounded-xl border border-[#e2e8f0] p-4">
            <div className="text-xs text-[#64748b] mb-1">Est. Impact</div>
            <div className="text-xl font-semibold text-[#0f172a]">{formatImpact(totalImpact)}</div>
            <div className="text-[11px] text-[#94a3b8] mt-0.5">{activeClass ? `Filtered: ${CLASS_LABELS[activeClass]}` : hasLineData ? "Deduped per line" : "Total"}</div>
          </div>
        </div>

        {/* Issue distribution across CDM lines (click a band to see those lines) */}
        {hasLineData && totalLines > 0 && (
          <div className="bg-white rounded-xl border border-[#e2e8f0] p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13.5px] font-semibold text-[#0f172a]">Lines by issue count</h3>
              <span className="text-[11px] text-[#94a3b8]">{totalLines.toLocaleString()} CDM lines · {dist.flagged.toLocaleString()} with issues</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {([
                ["Clean (0 issues)", dist.clean, "#16a34a", null],
                ["1–2 issues", dist.oneTwo, "#0a6cff", "1-2"],
                ["3–4 issues", dist.threeFour, "#d97706", "3-4"],
                ["5+ issues", dist.fivePlus, "#dc2626", "5+"],
              ] as [string, number, string, LineBucket | null][]).map(([label, val, color, b]) => {
                const on = b !== null && lineBucket === b;
                const clickable = b !== null && val > 0;
                return (
                  <button key={label} disabled={!clickable} onClick={() => b && pickBucket(b)}
                    className={`text-left rounded-xl border p-3 transition-colors ${on ? "border-[#1e293b] ring-1 ring-[#1e293b]" : "border-[#eef2f7]"} ${clickable ? "hover:border-[#cbd5e1] cursor-pointer" : "cursor-default"}`}>
                    <div className="flex items-center gap-2 mb-1"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} /><span className="text-[11.5px] font-medium text-[#475569]">{label}</span></div>
                    <div className="text-xl font-semibold text-[#0f172a] tabular-nums">{val.toLocaleString()}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* View toggle */}
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#64748b]">View:</span>
          <button onClick={() => { setLineView(false); setPage(1); }} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ${!lineView ? "bg-[#1e293b] text-white border-[#1e293b]" : "bg-white text-[#475569] border-[#e2e8f0] hover:bg-[#f6f7f9]"}`}><List size={14} /> Grouped to-dos</button>
          <button onClick={() => { setLineView(true); setPage(1); }} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ${lineView ? "bg-[#1e293b] text-white border-[#1e293b]" : "bg-white text-[#475569] border-[#e2e8f0] hover:bg-[#f6f7f9]"}`}><LayoutGrid size={14} /> Line cards</button>
          <a href={qs("record")} className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border bg-white text-[#475569] border-[#e2e8f0] hover:bg-[#f6f7f9]">By CDM line (table)</a>
          <a href={qs("lines")} className="ml-auto text-[12px] text-[#64748b] hover:underline">Show all lines</a>
        </div>

        {/* Filters (instant) */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px] relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search to-dos by code or description…" className="w-full pl-9 pr-4 py-2 text-sm border border-[#e2e8f0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#0f172a]/10" />
          </div>
          <CategoryFilter categories={bucketCats} selected={selectedCats} onChange={(v) => { setSelectedCats(v); setPage(1); }} />
        </div>

        {/* Line cards: one card per CDM line, showing how many issues it carries */}
        {lineView && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {pageLines.map((l) => {
                const isOpen = openLine === l.id;
                const tone = l.n >= 5 ? "#dc2626" : l.n >= 3 ? "#d97706" : "#0a6cff";
                return (
                  <div key={l.id} className={`bg-white rounded-xl border overflow-hidden ${isOpen ? "border-[#1e293b]" : "border-[#e2e8f0]"}`}>
                    <button onClick={() => toggleLine(l)} className="w-full text-left px-4 py-3 hover:bg-[#f8fafc]">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[13px] text-[#0f172a]">{l.proc || l.hcpcs || "—"}</span>
                            <Badge>{l.category}</Badge>
                          </div>
                          <div className="text-[12.5px] text-[#475569] truncate mt-0.5">{l.desc || "—"}</div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <div className="text-right">
                            <div className="text-[11px] text-[#94a3b8]">Est. impact</div>
                            <div className="text-[13px] font-semibold text-[#0f172a] tabular-nums">{l.max ? formatImpact(l.max) : "—"}</div>
                          </div>
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-semibold text-white" style={{ backgroundColor: tone }}>{l.n} {l.n === 1 ? "issue" : "issues"}</span>
                          <ChevronDown size={15} className={`text-[#94a3b8] transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </div>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="border-t border-[#eef2f7] bg-[#fbfcfe]">
                        {loadingLine === l.id ? (
                          <div className="flex items-center gap-2 text-[12px] text-[#94a3b8] px-4 py-3"><Loader2 size={13} className="animate-spin" /> Loading issues…</div>
                        ) : (
                          <div className="divide-y divide-[#f1f5f9]">
                            {(lineFindings[l.id] || []).map((f) => (
                              <button key={f.id} onClick={() => setDrawer(f)} className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-[#f4f6f8]">
                                <Badge>{f.category}</Badge>
                                <span className="flex-1 text-[12.5px] text-[#334155] truncate">{f.title}</span>
                                <span className="text-[12px] text-[#64748b] tabular-nums shrink-0">{f.financial_impact ? formatImpact(f.financial_impact) : ""}</span>
                                <Badge variant={statusVariant(f.status)}>{STATUS_LABEL[f.status] || f.status}</Badge>
                                <ChevronRight size={13} className="text-[#c5c5c0] shrink-0" />
                              </button>
                            ))}
                            {(lineFindings[l.id] || []).length === 0 && <div className="px-4 py-2 text-[12px] text-[#94a3b8]">No issues on this line in scope.</div>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {pageLines.length === 0 && <div className="lg:col-span-2 py-12 text-center text-[#94a3b8] text-sm bg-white rounded-xl border border-[#e2e8f0]">No CDM lines match the current filters.</div>}
            </div>
            <div className="flex items-center justify-between px-1">
              <span className="text-xs text-[#94a3b8]">{filteredLines.length.toLocaleString()} lines • Page {page} of {linePages}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 text-xs border border-[#e2e8f0] rounded-lg bg-white hover:bg-[#f6f7f9] disabled:opacity-40">Prev</button>
                <button onClick={() => setPage((p) => Math.min(linePages, p + 1))} disabled={page >= linePages} className="px-3 py-1 text-xs border border-[#e2e8f0] rounded-lg bg-white hover:bg-[#f6f7f9] disabled:opacity-40">Next</button>
              </div>
            </div>
          </div>
        )}

        {/* Grouped table */}
        {!lineView && (
        <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f4f6f8] border-b border-[#e2e8f0] text-left text-xs text-[#475569]">
                <th className="px-3 py-2.5 w-6" /><th className="px-3 py-2.5 font-medium">To-do</th><th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 font-medium text-right">Lines</th><th className="px-3 py-2.5 font-medium text-right">Est. impact</th><th className="px-3 py-2.5 font-medium text-right w-[230px]">Disposition all lines</th>
              </tr>
            </thead>
            <tbody>
              {pageGroups.map((g) => {
                const isOpen = openKey === g.grp_key;
                const busy = busyKey === g.grp_key;
                const applied = disp[g.grp_key];
                return (
                  <>
                    <tr key={g.grp_key} className="border-b border-[#f1f5f9] hover:bg-[#f9fafb]">
                      <td className="px-3 py-2.5 align-top"><button onClick={() => toggleExpand(g)} className="text-[#94a3b8] hover:text-[#334155]">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</button></td>
                      <td className="px-3 py-2.5 max-w-[380px]"><div className="text-[#334155] font-medium">{g.code ? `${g.category} — ${g.code}` : g.sample_title}</div><div className="text-[11px] text-[#94a3b8] truncate">{g.sample_title}</div></td>
                      <td className="px-3 py-2.5"><Badge>{g.category}</Badge></td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-[#475569]">{g.line_count.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#0f172a]">{g.impact ? formatImpact(g.impact) : "—"}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          {applied ? <Badge variant={statusVariant(applied)}>{STATUS_LABEL[applied]}</Badge> : busy ? <Loader2 size={14} className="animate-spin text-[#94a3b8]" /> : (<>
                            <button onClick={() => disposition(g, "accepted")} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-semibold text-[#067647] bg-[#e7f7ef] hover:bg-[#d6f0e2]"><Check size={13} /> Accept</button>
                            <button onClick={() => disposition(g, "rejected")} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-semibold text-[#b42318] bg-[#fdeceb] hover:bg-[#fbdcd9]"><X size={13} /> Deny</button>
                            <button onClick={() => disposition(g, "na")} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium text-[#64748b] bg-[#f1f5f9] hover:bg-[#e6ebf1]"><MinusCircle size={13} /> N/A</button>
                          </>)}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={g.grp_key + "-x"} className="bg-[#fbfcfe] border-b border-[#f1f5f9]">
                        <td /><td colSpan={5} className="px-3 py-2">
                          {loadingKey === g.grp_key ? <div className="flex items-center gap-2 text-[12px] text-[#94a3b8] py-2"><Loader2 size={13} className="animate-spin" /> Loading lines…</div> : (
                            <div className="rounded-lg border border-[#eef2f7] bg-white overflow-hidden">
                              <div className="px-3 py-1.5 text-[11px] text-[#94a3b8] bg-[#f8fafc] border-b border-[#eef2f7]">Click a line for full detail, or use the group buttons above to disposition all {g.line_count} at once.</div>
                              <div className="divide-y divide-[#f1f5f9]">
                                {(lines[g.grp_key] || []).map((l: any) => (
                                  <button key={l.id} onClick={() => setDrawer(l)} className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#f4f6f8]">
                                    <span className="text-[12px] text-[#64748b] w-[110px] shrink-0 tabular-nums">{l.charge_items?.procedure_number || "—"}</span>
                                    <span className="flex-1 text-[12.5px] text-[#334155] truncate">{l.charge_items?.charge_description || l.title}</span>
                                    <span className="text-[12px] text-[#64748b] w-[80px] text-right shrink-0">{l.charge_items?.gross_charge != null ? `$${Number(l.charge_items.gross_charge).toLocaleString()}` : ""}</span>
                                    <Badge variant={statusVariant(l.status)}>{STATUS_LABEL[l.status] || l.status}</Badge>
                                    <ChevronRight size={13} className="text-[#c5c5c0] shrink-0" />
                                  </button>
                                ))}
                                {(lines[g.grp_key] || []).length === 0 && <div className="px-3 py-2 text-[12px] text-[#94a3b8]">No lines.</div>}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
              {pageGroups.length === 0 && <tr><td colSpan={6} className="py-12 text-center text-[#94a3b8] text-sm">No to-dos match the current filters.</td></tr>}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8f0] bg-[#f4f6f8]">
            <span className="text-xs text-[#94a3b8]">{filteredGroups.length.toLocaleString()} to-dos • Page {page} of {totalPages}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 text-xs border border-[#e2e8f0] rounded-lg hover:bg-white disabled:opacity-40">Prev</button>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-3 py-1 text-xs border border-[#e2e8f0] rounded-lg hover:bg-white disabled:opacity-40">Next</button>
            </div>
          </div>
        </div>
        )}
      </>)}

      {drawer && <FindingDrawer finding={drawer} onClose={() => setDrawer(null)} canAssign={canAssign} users={users} assigneeNames={assigneeNames} />}
    </div>
  );
}

function CategoryFilter({ categories, selected, onChange }: { categories: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const toggle = (c: string) => onChange(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]);
  const label = selected.length === 0 ? "All Categories" : selected.length === 1 ? selected[0] : `${selected.length} categories`;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-sm border border-[#e2e8f0] rounded-lg px-3 py-2 bg-white flex items-center gap-2 min-w-[160px] justify-between">
        <span className="truncate max-w-[200px]">{label}</span><ChevronRight size={14} className={`text-[#94a3b8] transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (<>
        <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
        <div className="absolute z-20 mt-1 w-64 max-h-72 overflow-y-auto bg-white border border-[#e2e8f0] rounded-lg shadow-lg py-1">
          <button onClick={() => onChange([])} className="w-full text-left px-3 py-1.5 text-sm text-[#1e293b] hover:bg-[#f1f5f9]">Clear all</button>
          {categories.map((c) => (
            <label key={c} className="flex items-center gap-2 px-3 py-1.5 text-sm text-[#334155] hover:bg-[#f1f5f9] cursor-pointer">
              <input type="checkbox" checked={selected.includes(c)} onChange={() => toggle(c)} /><span className="truncate">{c}</span>
            </label>
          ))}
          {categories.length === 0 && <div className="px-3 py-2 text-xs text-[#94a3b8]">No categories</div>}
        </div>
      </>)}
    </div>
  );
}
