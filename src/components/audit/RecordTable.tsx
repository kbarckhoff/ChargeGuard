"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, SeverityDot, formatImpact } from "@/components/ui/shared";
import { FindingDrawer, type FindingRow } from "@/components/audit/FindingsTable";
import { Search, ChevronRight, ChevronDown, Loader2 } from "lucide-react";

// One CDM line that has at least one in-scope finding.
export type RecordLine = {
  id: string;
  record_no: number | null;      // 1-based file position (null until re-import)
  procedure_number: string | null;
  hcpcs_cpt_code: string | null;
  charge_description: string | null;
  issue_count: number;
  worst_sev: string | null;
  categories: string[];
  impact: number;
};

export function RecordTable({
  lines, total, page, totalPages, search, canAssign, users, assigneeNames,
}: {
  lines: RecordLine[];
  total: number;
  page: number;
  totalPages: number;
  search: string;
  canAssign: boolean;
  users: { id: string; full_name: string; email: string; department: string | null }[];
  assigneeNames: Record<string, string>;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(null);
  const [members, setMembers] = useState<Record<string, FindingRow[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<FindingRow | null>(null);

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => { if (v && v !== "all") params.set(k, v); else params.delete(k); });
    if (!updates.page) params.delete("page");
    router.push(`/findings?${params.toString()}`);
  };

  const toggle = async (l: RecordLine) => {
    if (openId === l.id) { setOpenId(null); return; }
    setOpenId(l.id);
    if (!members[l.id]) {
      setLoadingId(l.id);
      try {
        const r = await fetch(`/api/findings/by-line?lineId=${encodeURIComponent(l.id)}`);
        const d = await r.json();
        setMembers((prev) => ({ ...prev, [l.id]: d.lines || [] }));
      } catch { /* ignore */ } finally { setLoadingId(null); }
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
          <input type="text" defaultValue={search}
            onChange={(e) => { clearTimeout((window as any).__recSearch); (window as any).__recSearch = setTimeout(() => updateParams({ search: e.target.value }), 400); }}
            placeholder="Search by record #, code, or description…"
            className="w-full pl-9 pr-4 py-2 text-sm border border-[#e2e8f0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#0f172a]/10" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f4f6f8] border-b border-[#e2e8f0] text-left text-xs text-[#475569]">
              <th className="px-3 py-2.5 w-6" />
              <th className="px-3 py-2.5 font-medium">Record #</th>
              <th className="px-3 py-2.5 font-medium">HCPCS/CPT</th>
              <th className="px-3 py-2.5 font-medium">Description</th>
              <th className="px-3 py-2.5 font-medium">Issues</th>
              <th className="px-3 py-2.5 font-medium">Severity</th>
              <th className="px-3 py-2.5 font-medium text-right">Est. impact</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const isOpen = openId === l.id;
              return (
                <>
                  <tr key={l.id} className="border-b border-[#f1f5f9] hover:bg-[#f9fafb] cursor-pointer" onClick={() => toggle(l)}>
                    <td className="px-3 py-2.5 align-top">{isOpen ? <ChevronDown size={15} className="text-[#94a3b8]" /> : <ChevronRight size={15} className="text-[#94a3b8]" />}</td>
                    <td className="px-3 py-2.5 font-medium text-[#0f172a] tabular-nums">{l.record_no ?? "—"}</td>
                    <td className="px-3 py-2.5 text-[#475569]">{l.hcpcs_cpt_code || "—"}</td>
                    <td className="px-3 py-2.5 max-w-[320px]"><div className="text-[#334155] truncate">{l.charge_description || "—"}</div></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[12px] font-semibold text-[#334155]">{l.issue_count}</span>
                        {l.categories.slice(0, 2).map((c) => <Badge key={c}>{c}</Badge>)}
                        {l.categories.length > 2 && <span className="text-[11px] text-[#94a3b8]">+{l.categories.length - 2}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">{l.worst_sev ? <div className="flex items-center gap-1.5"><SeverityDot severity={l.worst_sev} /><span className="text-[12px] text-[#64748b] capitalize">{l.worst_sev}</span></div> : <span className="text-[#cbd5e1]">—</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#475569]">{l.impact ? formatImpact(l.impact) : "—"}</td>
                  </tr>
                  {isOpen && (
                    <tr key={l.id + "-x"} className="bg-[#fbfcfe] border-b border-[#f1f5f9]">
                      <td />
                      <td colSpan={6} className="px-3 py-2">
                        {loadingId === l.id ? (
                          <div className="flex items-center gap-2 text-[12px] text-[#94a3b8] py-2"><Loader2 size={13} className="animate-spin" /> Loading issues…</div>
                        ) : (
                          <div className="rounded-lg border border-[#eef2f7] divide-y divide-[#f1f5f9]">
                            {(members[l.id] || []).map((f) => (
                              <button key={f.id} onClick={(e) => { e.stopPropagation(); setDrawer(f); }} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f4f6f8]">
                                <SeverityDot severity={f.severity} />
                                <span className="flex-1 text-[12.5px] text-[#334155] truncate">{f.title}</span>
                                <Badge>{f.category}</Badge>
                                <ChevronRight size={13} className="text-[#c5c5c0]" />
                              </button>
                            ))}
                            {(members[l.id] || []).length === 0 && <div className="px-3 py-2 text-[12px] text-[#94a3b8]">No issues.</div>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {lines.length === 0 && <tr><td colSpan={7} className="py-12 text-center text-[#94a3b8] text-sm">No CDM lines with issues match the current filters.</td></tr>}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8f0] bg-[#f4f6f8]">
          <span className="text-xs text-[#94a3b8]">{total.toLocaleString()} lines with issues • Page {page} of {totalPages || 1}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => updateParams({ page: String(Math.max(1, page - 1)) })} disabled={page <= 1} className="px-3 py-1 text-xs border border-[#e2e8f0] rounded-lg hover:bg-white disabled:opacity-40">Prev</button>
            <button onClick={() => updateParams({ page: String(Math.min(totalPages, page + 1)) })} disabled={page >= totalPages} className="px-3 py-1 text-xs border border-[#e2e8f0] rounded-lg hover:bg-white disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>

      {drawer && <FindingDrawer finding={drawer} onClose={() => setDrawer(null)} canAssign={canAssign} users={users} assigneeNames={assigneeNames} />}
    </>
  );
}
