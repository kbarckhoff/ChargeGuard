"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, SeverityDot, SEVERITY_CONFIG } from "@/components/ui/shared";
import { Search, X, Check, Ban, ChevronRight, Loader2, ExternalLink } from "lucide-react";

interface FindingRow {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  category: string;
  financial_impact: number | null;
  recommendation: string;
  charge_item_id: string | null;
  created_at: string;
  charge_items: {
    procedure_number: string;
    charge_description: string;
    hcpcs_cpt_code: string;
    revenue_code: string;
    gross_charge: number;
  } | null;
}

export function FindingsTable({
  findings,
  total,
  page,
  totalPages,
  severityFilter,
  statusFilter,
  categoryFilter,
  search,
  categories,
}: {
  findings: FindingRow[];
  total: number;
  page: number;
  totalPages: number;
  severityFilter: string;
  statusFilter: string;
  categoryFilter: string;
  search: string;
  categories: string[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<FindingRow | null>(null);

  const updateParams = (updates: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([k, v]) => {
      if (v && v !== "all") {
        params.set(k, v);
      } else {
        params.delete(k);
      }
    });
    if (!updates.page) params.delete("page");
    router.push(`/findings?${params.toString()}`);
  };

  return (
    <>
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px] relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9a9a95]" />
          <input
            type="text"
            defaultValue={search}
            onChange={(e) => {
              clearTimeout((window as any).__findSearch);
              (window as any).__findSearch = setTimeout(() => updateParams({ search: e.target.value }), 400);
            }}
            placeholder="Search findings…"
            className="w-full pl-9 pr-4 py-2 text-sm border border-[#e5e5e0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1a1a18]/10"
          />
        </div>
        <select value={severityFilter} onChange={(e) => updateParams({ severity: e.target.value })}
          className="text-sm border border-[#e5e5e0] rounded-lg px-3 py-2 bg-white">
          <option value="all">All Severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={statusFilter} onChange={(e) => updateParams({ status: e.target.value })}
          className="text-sm border border-[#e5e5e0] rounded-lg px-3 py-2 bg-white">
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="resolved">Resolved</option>
        </select>
        <select value={categoryFilter} onChange={(e) => updateParams({ category: e.target.value })}
          className="text-sm border border-[#e5e5e0] rounded-lg px-3 py-2 bg-white">
          <option value="all">All Categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#e5e5e0] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#fafaf8] border-b border-[#e5e5e0]">
                <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs w-6" />
                <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs">Finding</th>
                <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs">Category</th>
                <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs">Charge Item</th>
                <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs">Status</th>
                <th className="px-3 py-2.5 text-right font-medium text-[#5a5a55] text-xs">Impact</th>
                <th className="px-3 py-2.5 text-left font-medium text-[#5a5a55] text-xs w-8" />
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}
                  onClick={() => setSelected(f)}
                  className="border-b border-[#f5f5f0] hover:bg-[#fafaf8] cursor-pointer transition-colors">
                  <td className="px-3 py-2.5"><SeverityDot severity={f.severity} /></td>
                  <td className="px-3 py-2.5 max-w-[350px]">
                    <div className="text-[#3d3d3a] font-medium truncate">{f.title}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge>{f.category}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[#7a7a75]">
                    {f.charge_items ? (
                      <span>{f.charge_items.procedure_number} — {f.charge_items.hcpcs_cpt_code || "No CPT"}</span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge variant={
                      f.status === "accepted" ? "success" :
                      f.status === "rejected" ? "danger" :
                      f.status === "resolved" ? "purple" :
                      "default"
                    }>
                      {f.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-[#5a5a55]">
                    {f.financial_impact ? `$${f.financial_impact.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <ChevronRight size={14} className="text-[#c5c5c0]" />
                  </td>
                </tr>
              ))}
              {findings.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#9a9a95] text-sm">
                    No findings match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#e5e5e0] bg-[#fafaf8]">
          <span className="text-xs text-[#9a9a95]">{total.toLocaleString()} findings • Page {page} of {totalPages || 1}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => updateParams({ page: String(Math.max(1, page - 1)) })} disabled={page <= 1}
              className="px-3 py-1 text-xs border border-[#e5e5e0] rounded-lg hover:bg-white disabled:opacity-40">Prev</button>
            <button onClick={() => updateParams({ page: String(Math.min(totalPages, page + 1)) })} disabled={page >= totalPages}
              className="px-3 py-1 text-xs border border-[#e5e5e0] rounded-lg hover:bg-white disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>

      {/* Detail Drawer */}
      {selected && (
        <FindingDrawer finding={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}

// ─── Finding Detail Drawer ───────────────────────────────────

function FindingDrawer({ finding, onClose }: { finding: FindingRow; onClose: () => void }) {
  const [updating, setUpdating] = useState(false);
  const [currentStatus, setCurrentStatus] = useState(finding.status);
  const router = useRouter();

  const updateStatus = async (newStatus: string) => {
    setUpdating(true);
    try {
      const res = await fetch("/api/findings/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: finding.id, status: newStatus }),
      });
      if (res.ok) {
        setCurrentStatus(newStatus);
        router.refresh();
      }
    } catch {
      // ignore
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden animate-slide-in">
        <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}.animate-slide-in{animation:slideIn .2s ease-out}`}</style>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e5e0]">
          <div className="flex items-center gap-2">
            <SeverityDot severity={finding.severity} />
            <Badge variant={
              finding.severity === "critical" ? "danger" :
              finding.severity === "high" ? "warning" : "default"
            }>
              {finding.severity}
            </Badge>
            <Badge variant={
              currentStatus === "accepted" ? "success" :
              currentStatus === "rejected" ? "danger" :
              currentStatus === "resolved" ? "purple" : "default"
            }>
              {currentStatus}
            </Badge>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-[#f5f5f0] rounded-lg"><X size={18} /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-[#1a1a18] leading-snug">{finding.title}</h3>
            {finding.category && (
              <div className="mt-2"><Badge>{finding.category}</Badge></div>
            )}
          </div>

          {/* Charge Item Info */}
          {finding.charge_items && (
            <div className="p-4 bg-[#f5f5f0] rounded-xl space-y-2">
              <div className="text-xs font-medium text-[#7a7a75]">Affected Charge Item</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-xs text-[#9a9a95]">Proc #</span>
                  <div className="font-mono text-[#1a1a18]">{finding.charge_items.procedure_number}</div>
                </div>
                <div>
                  <span className="text-xs text-[#9a9a95]">HCPCS/CPT</span>
                  <div className="font-mono text-[#1a1a18]">{finding.charge_items.hcpcs_cpt_code || "—"}</div>
                </div>
                <div>
                  <span className="text-xs text-[#9a9a95]">Rev Code</span>
                  <div className="font-mono text-[#1a1a18]">{finding.charge_items.revenue_code}</div>
                </div>
                <div>
                  <span className="text-xs text-[#9a9a95]">Price</span>
                  <div className="font-mono text-[#1a1a18]">${Number(finding.charge_items.gross_charge).toLocaleString()}</div>
                </div>
              </div>
              <div>
                <span className="text-xs text-[#9a9a95]">Description</span>
                <div className="text-sm text-[#3d3d3a]">{finding.charge_items.charge_description}</div>
              </div>
            </div>
          )}

          {/* Financial Impact */}
          {finding.financial_impact && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="text-xs font-medium text-amber-700 mb-1">Estimated Financial Impact</div>
              <div className="text-xl font-semibold text-amber-900">${finding.financial_impact.toLocaleString()}</div>
            </div>
          )}

          {/* Description */}
          {finding.description && (
            <div>
              <div className="text-xs font-medium text-[#7a7a75] mb-1.5">Issue Details</div>
              <div className="text-sm text-[#3d3d3a] leading-relaxed">{finding.description}</div>
            </div>
          )}

          {/* Recommendation */}
          {finding.recommendation && (
            <div>
              <div className="text-xs font-medium text-[#7a7a75] mb-1.5">Recommendation</div>
              <div className="text-sm text-[#3d3d3a] leading-relaxed p-3 bg-blue-50 border border-blue-200 rounded-xl">
                {finding.recommendation}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="px-5 py-3 border-t border-[#e5e5e0] flex items-center gap-2">
          {currentStatus === "open" ? (
            <>
              <button
                onClick={() => updateStatus("accepted")}
                disabled={updating}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                {updating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Accept Finding
              </button>
              <button
                onClick={() => updateStatus("rejected")}
                disabled={updating}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 border border-[#e5e5e0] rounded-lg text-sm font-medium text-[#5a5a55] hover:bg-[#f5f5f0] disabled:opacity-50"
              >
                {updating ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                Reject
              </button>
            </>
          ) : currentStatus === "accepted" ? (
            <>
              <button
                onClick={() => updateStatus("resolved")}
                disabled={updating}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-[#1a1a18] text-white rounded-lg text-sm font-medium hover:bg-[#2d2d2a] disabled:opacity-50"
              >
                {updating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                Mark Resolved
              </button>
              <button
                onClick={() => updateStatus("open")}
                disabled={updating}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 border border-[#e5e5e0] rounded-lg text-sm font-medium text-[#5a5a55] hover:bg-[#f5f5f0] disabled:opacity-50"
              >
                Reopen
              </button>
            </>
          ) : (
            <button
              onClick={() => updateStatus("open")}
              disabled={updating}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 border border-[#e5e5e0] rounded-lg text-sm font-medium text-[#5a5a55] hover:bg-[#f5f5f0] disabled:opacity-50"
            >
              Reopen Finding
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
