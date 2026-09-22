"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, formatImpact } from "@/components/ui/shared";
import { Search, ChevronRight, ChevronDown, Loader2, Check, X, MinusCircle } from "lucide-react";

export type TodoGroup = {
  grp_key: string;
  category: string;
  code: string;
  line_count: number;
  open_count: number;
  impact: number;
  sample_title: string;
  sample_proc: string | null;
};

type Line = {
  id: string; title: string; status: string; financial_impact: number | null;
  charge_items: { procedure_number: string; hcpcs_cpt_code: string; revenue_code: string; charge_description: string; gross_charge: number } | null;
};

const STATUS_LABEL: Record<string, string> = { open: "Open", in_review: "Under Review", accepted: "Accepted", rejected: "Denied", na: "N/A", resolved: "Accepted" };
const statusVariant = (s: string): any => s === "accepted" || s === "resolved" ? "success" : s === "rejected" ? "danger" : s === "in_review" ? "purple" : s === "na" ? "default" : "default";

export function TodoTable({
  groups, total, page, totalPages, auditId, search,
}: {
  groups: TodoGroup[]; total: number; page: number; totalPages: number; auditId: string; search: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, Line[]>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => { if (v && v !== "all") params.set(k, v); else params.delete(k); });
    if (!updates.page) params.delete("page");
    router.push(`/findings?${params.toString()}`);
  };

  const disposition = async (g: TodoGroup, status: string) => {
    setBusyKey(g.grp_key);
    try {
      await fetch("/api/findings/disposition-group", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auditId, grpKey: g.grp_key, status }),
      });
      router.refresh();
    } catch { /* ignore */ } finally { setBusyKey(null); }
  };

  const toggle = async (g: TodoGroup) => {
    if (openKey === g.grp_key) { setOpenKey(null); return; }
    setOpenKey(g.grp_key);
    if (!lines[g.grp_key]) {
      setLoadingKey(g.grp_key);
      try {
        const r = await fetch(`/api/findings/group-lines?auditId=${auditId}&grpKey=${encodeURIComponent(g.grp_key)}`);
        const d = await r.json();
        setLines((prev) => ({ ...prev, [g.grp_key]: d.lines || [] }));
      } catch { /* ignore */ } finally { setLoadingKey(null); }
    }
  };

  return (
    <>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
          <input type="text" defaultValue={search}
            onChange={(e) => { clearTimeout((window as any).__todoSearch); (window as any).__todoSearch = setTimeout(() => updateParams({ search: e.target.value }), 400); }}
            placeholder="Search to-dos by code or description…"
            className="w-full pl-9 pr-4 py-2 text-sm border border-[#e2e8f0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#0f172a]/10" />
        </div>
        <a href={`/findings?${new URLSearchParams({ ...Object.fromEntries(searchParams.entries()), view: "lines" }).toString()}`}
          className="text-sm border border-[#e2e8f0] rounded-lg px-3 py-2 bg-white text-[#374151] hover:bg-[#f6f7f9]">Show all lines</a>
      </div>

      <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[#f4f6f8] border-b border-[#e2e8f0] text-left text-xs text-[#475569]">
              <th className="px-3 py-2.5 w-6" />
              <th className="px-3 py-2.5 font-medium">To-do</th>
              <th className="px-3 py-2.5 font-medium">Category</th>
              <th className="px-3 py-2.5 font-medium text-right">Lines</th>
              <th className="px-3 py-2.5 font-medium text-right">Est. impact</th>
              <th className="px-3 py-2.5 font-medium text-right w-[220px]">Disposition all lines</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const isOpen = openKey === g.grp_key;
              const busy = busyKey === g.grp_key;
              return (
                <>
                  <tr key={g.grp_key} className="border-b border-[#f1f5f9] hover:bg-[#f9fafb]">
                    <td className="px-3 py-2.5 align-top">
                      <button onClick={() => toggle(g)} className="text-[#94a3b8] hover:text-[#334155]">
                        {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 max-w-[380px]">
                      <div className="text-[#334155] font-medium">{g.code ? `${g.category} — ${g.code}` : g.sample_title}</div>
                      <div className="text-[11px] text-[#94a3b8] truncate">{g.sample_title}</div>
                    </td>
                    <td className="px-3 py-2.5"><Badge>{g.category}</Badge></td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[#475569]">
                      {g.line_count.toLocaleString()}
                      {g.open_count > 0 && g.open_count < g.line_count && <span className="text-[11px] text-[#94a3b8]"> ({g.open_count} open)</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#0f172a]">{g.impact ? formatImpact(g.impact) : "—"}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {busy ? <Loader2 size={14} className="animate-spin text-[#94a3b8]" /> : (<>
                          <button onClick={() => disposition(g, "accepted")} title="Accept all lines" className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-semibold text-[#067647] bg-[#e7f7ef] hover:bg-[#d6f0e2]"><Check size={13} /> Accept</button>
                          <button onClick={() => disposition(g, "rejected")} title="Deny all lines" className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-semibold text-[#b42318] bg-[#fdeceb] hover:bg-[#fbdcd9]"><X size={13} /> Deny</button>
                          <button onClick={() => disposition(g, "na")} title="Mark all N/A" className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[12px] font-medium text-[#64748b] bg-[#f1f5f9] hover:bg-[#e6ebf1]"><MinusCircle size={13} /> N/A</button>
                        </>)}
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr key={g.grp_key + "-x"} className="bg-[#fbfcfe] border-b border-[#f1f5f9]">
                      <td />
                      <td colSpan={5} className="px-3 py-2">
                        {loadingKey === g.grp_key ? (
                          <div className="flex items-center gap-2 text-[12px] text-[#94a3b8] py-2"><Loader2 size={13} className="animate-spin" /> Loading lines…</div>
                        ) : (
                          <div className="rounded-lg border border-[#eef2f7] overflow-hidden">
                            <table className="w-full text-[12.5px]">
                              <tbody>
                                {(lines[g.grp_key] || []).map((l) => (
                                  <tr key={l.id} className="border-b border-[#f1f5f9] last:border-0">
                                    <td className="px-3 py-1.5 text-[#64748b] w-[120px]">{l.charge_items?.procedure_number || "—"}</td>
                                    <td className="px-3 py-1.5 text-[#334155]">{l.charge_items?.charge_description || l.title}</td>
                                    <td className="px-3 py-1.5 text-[#64748b] w-[90px]">{l.charge_items?.gross_charge != null ? `$${Number(l.charge_items.gross_charge).toLocaleString()}` : ""}</td>
                                    <td className="px-3 py-1.5 w-[110px]"><Badge variant={statusVariant(l.status)}>{STATUS_LABEL[l.status] || l.status}</Badge></td>
                                  </tr>
                                ))}
                                {(lines[g.grp_key] || []).length === 0 && <tr><td className="px-3 py-2 text-[#94a3b8]">No lines.</td></tr>}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
            {groups.length === 0 && (
              <tr><td colSpan={6} className="py-12 text-center text-[#94a3b8] text-sm">No to-dos match the current filters.</td></tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8f0] bg-[#f4f6f8]">
          <span className="text-xs text-[#94a3b8]">{total.toLocaleString()} to-dos • Page {page} of {totalPages || 1}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => updateParams({ page: String(Math.max(1, page - 1)) })} disabled={page <= 1} className="px-3 py-1 text-xs border border-[#e2e8f0] rounded-lg hover:bg-white disabled:opacity-40">Prev</button>
            <button onClick={() => updateParams({ page: String(Math.min(totalPages, page + 1)) })} disabled={page >= totalPages} className="px-3 py-1 text-xs border border-[#e2e8f0] rounded-lg hover:bg-white disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </>
  );
}
