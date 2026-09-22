"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, SeverityDot, formatImpact } from "@/components/ui/shared";
import { FindingDrawer, type FindingRow } from "@/components/audit/FindingsTable";
import { Search, ChevronRight, ChevronDown } from "lucide-react";

export type RecordLine = {
  id: string;
  procedure_number: string | null;
  hcpcs_cpt_code: string | null;
  charge_description: string | null;
  revenue_code: string | null;
  gross_charge: number | null;
  findings: FindingRow[];
};

const SEV_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
function worstSeverity(fs: FindingRow[]): string | null {
  let best: string | null = null; let rank = 0;
  for (const f of fs) { const r = SEV_RANK[f.severity] || 0; if (r > rank) { rank = r; best = f.severity; } }
  return best;
}

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
  const [drawer, setDrawer] = useState<FindingRow | null>(null);

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => { if (v && v !== "all") params.set(k, v); else params.delete(k); });
    if (!updates.page) params.delete("page");
    router.push(`/findings?${params.toString()}`);
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
              const sev = worstSeverity(l.findings);
              const impact = l.findings.reduce((s, f) => s + (f.financial_impact || 0), 0);
              const cats = [...new Set(l.findings.map((f) => f.category))];
              return (
                <>
                  <tr key={l.id} className={`border-b border-[#f1f5f9] ${l.findings.length ? "hover:bg-[#f9fafb] cursor-pointer" : ""}`} onClick={() => l.findings.length && setOpenId(isOpen ? null : l.id)}>
                    <td className="px-3 py-2.5 align-top">
                      {l.findings.length > 0 && (isOpen ? <ChevronDown size={15} className="text-[#94a3b8]" /> : <ChevronRight size={15} className="text-[#94a3b8]" />)}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-[#0f172a] tabular-nums">{l.procedure_number || "—"}</td>
                    <td className="px-3 py-2.5 text-[#475569]">{l.hcpcs_cpt_code || "—"}</td>
                    <td className="px-3 py-2.5 max-w-[320px]"><div className="text-[#334155] truncate">{l.charge_description || "—"}</div></td>
                    <td className="px-3 py-2.5">
                      {l.findings.length === 0 ? (
                        <span className="text-[12px] text-[#94a3b8]">No issues</span>
                      ) : (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[12px] font-semibold text-[#334155]">{l.findings.length}</span>
                          {cats.slice(0, 2).map((c) => <Badge key={c}>{c}</Badge>)}
                          {cats.length > 2 && <span className="text-[11px] text-[#94a3b8]">+{cats.length - 2}</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">{sev ? <div className="flex items-center gap-1.5"><SeverityDot severity={sev} /><span className="text-[12px] text-[#64748b] capitalize">{sev}</span></div> : <span className="text-[#cbd5e1]">—</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#475569]">{impact ? formatImpact(impact) : "—"}</td>
                  </tr>
                  {isOpen && l.findings.length > 0 && (
                    <tr key={l.id + "-x"} className="bg-[#fbfcfe] border-b border-[#f1f5f9]">
                      <td />
                      <td colSpan={6} className="px-3 py-2">
                        <div className="rounded-lg border border-[#eef2f7] divide-y divide-[#f1f5f9]">
                          {l.findings.map((f) => (
                            <button key={f.id} onClick={(e) => { e.stopPropagation(); setDrawer(f); }} className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f4f6f8]">
                              <SeverityDot severity={f.severity} />
                              <span className="flex-1 text-[12.5px] text-[#334155] truncate">{f.title}</span>
                              <Badge>{f.category}</Badge>
                              <ChevronRight size={13} className="text-[#c5c5c0]" />
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {lines.length === 0 && <tr><td colSpan={7} className="py-12 text-center text-[#94a3b8] text-sm">No CDM lines match the current filters.</td></tr>}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8f0] bg-[#f4f6f8]">
          <span className="text-xs text-[#94a3b8]">{total.toLocaleString()} CDM lines • Page {page} of {totalPages || 1}</span>
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
