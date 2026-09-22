"use client";

import { useMemo, useState } from "react";
import { Badge, formatImpact } from "@/components/ui/shared";
import { bucketForCategory, categoriesInBucket, BUCKET_LABELS, type FindingBucket } from "@/lib/finding-buckets";
import { classForCategory, categoriesInClass, CLASS_LABELS, CLASS_BLURB, CLASS_COLOR, type FindingClass } from "@/lib/finding-class";
import { PeerAnalysisTab } from "@/components/assessment/AssessmentFlow";
import { Search, ChevronRight, ChevronDown, Loader2, Check, X, MinusCircle, AlertTriangle } from "lucide-react";

type Agg = { category: string | null; status: string | null; cnt: number; impact: number };
type TodoGroup = { grp_key: string; category: string; code: string; line_count: number; open_count: number; impact: number; sample_title: string; sample_proc: string | null };
type Lagging = { id: string; title: string; category: string; resolution_note: string | null; charge_items: { procedure_number: string; hcpcs_cpt_code: string } | null };

const TABS: FindingBucket[] = ["cdm", "rvu", "formulary", "peer"];
const CLASSES: FindingClass[] = ["code_validity", "pricing", "data_quality", "informational"];
const PAGE_SIZE = 50;

const STATUS_LABEL: Record<string, string> = { open: "Open", in_review: "Under Review", accepted: "Accepted", rejected: "Denied", na: "N/A", resolved: "Accepted" };
const statusVariant = (s: string): any => s === "accepted" || s === "resolved" ? "success" : s === "rejected" ? "danger" : s === "in_review" ? "purple" : s === "na" ? "default" : "default";

export function FindingsWorkspace({
  auditId, agg, allTodos, lagging,
}: {
  auditId: string;
  agg: Agg[];
  allTodos: TodoGroup[];
  lagging: Lagging[];
}) {
  const [tab, setTab] = useState<FindingBucket>("cdm");
  const [activeClass, setActiveClass] = useState<FindingClass | null>(null);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  // Group disposition (applied locally so the list updates without a reload).
  const [disp, setDisp] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, any[]>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const reset = (t: FindingBucket) => { setTab(t); setActiveClass(null); setSelectedCats([]); setSearch(""); setPage(1); };

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

  const totalImpact = useMemo(() => agg.filter((a) => bucketForCategory(a.category) === tab).reduce((s, a) => s + a.impact, 0), [agg, tab]);

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
  const grandTotal = useMemo(() => agg.reduce((s, a) => s + a.cnt, 0), [agg]);

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
            <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[#eef2f7]">
              <div>
                <h3 className="text-[13.5px] font-semibold text-[#0f172a]">Top findings by impact</h3>
                <p className="text-[12px] text-[#64748b] mt-0.5">{rollup.length} systemic {rollup.length === 1 ? "issue" : "issues"} · {grandTotal.toLocaleString()} total flags · {formatImpact(rollup.reduce((s, r) => s + r.impact, 0))} estimated exposure</p>
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
            {activeClass && <div className="text-[11px] text-[#94a3b8] mt-0.5">Filtered: {CLASS_LABELS[activeClass]}</div>}
          </div>
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#64748b]">View:</span>
          <button className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border bg-[#1e293b] text-white border-[#1e293b]">Grouped to-dos</button>
          <a href={qs("record")} className="px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border bg-white text-[#475569] border-[#e2e8f0] hover:bg-[#f6f7f9]">By CDM line</a>
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

        {/* Grouped table */}
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
                            <div className="rounded-lg border border-[#eef2f7] overflow-hidden"><table className="w-full text-[12.5px]"><tbody>
                              {(lines[g.grp_key] || []).map((l: any) => (
                                <tr key={l.id} className="border-b border-[#f1f5f9] last:border-0">
                                  <td className="px-3 py-1.5 text-[#64748b] w-[120px]">{l.charge_items?.procedure_number || "—"}</td>
                                  <td className="px-3 py-1.5 text-[#334155]">{l.charge_items?.charge_description || l.title}</td>
                                  <td className="px-3 py-1.5 text-[#64748b] w-[90px]">{l.charge_items?.gross_charge != null ? `$${Number(l.charge_items.gross_charge).toLocaleString()}` : ""}</td>
                                  <td className="px-3 py-1.5 w-[110px]"><Badge variant={statusVariant(l.status)}>{STATUS_LABEL[l.status] || l.status}</Badge></td>
                                </tr>
                              ))}
                              {(lines[g.grp_key] || []).length === 0 && <tr><td className="px-3 py-2 text-[#94a3b8]">No lines.</td></tr>}
                            </tbody></table></div>
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
      </>)}
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
