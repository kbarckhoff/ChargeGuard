"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, SeverityDot, SEVERITY_CONFIG } from "@/components/ui/shared";
import { Search, X, ChevronRight, Loader2 } from "lucide-react";

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
  applied_field?: string | null;
  applied_old?: string | null;
  applied_new?: string | null;
  resolution_note?: string | null;
  is_carried?: boolean | null;
  tier?: number | null;
  charge_items: {
    procedure_number: string;
    charge_description: string;
    hcpcs_cpt_code: string;
    revenue_code: string;
    gross_charge: number;
  } | null;
}

// Best-guess CDM field to correct, based on the finding's category.
const FIELD_LABELS: Record<string, string> = {
  hcpcs_cpt_code: "HCPCS / CPT code",
  gross_charge: "Gross charge",
  revenue_code: "Revenue code",
  charge_description: "Description",
};
// Disposition options while we present findings (no file edits yet).
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_review: "Under Review",
  accepted: "Accepted",
  rejected: "Denied",
  na: "N/A",
  resolved: "Accepted",
};
const statusLabel = (s: string) => STATUS_LABELS[s] || s;
const statusVariant = (s: string): any =>
  s === "accepted" || s === "resolved" ? "success" : s === "rejected" ? "danger" : s === "in_review" ? "purple" : s === "na" ? "default" : "default";

// Tier badge: how the finding relates to prior reviews of the same line.
const TIER_META: Record<number, { label: string; title: string; cls: string }> = {
  1: { label: "T1 New", title: "Brand new finding", cls: "bg-[#e0edff] text-[#1d4ed8]" },
  2: { label: "T2 Accepted before", title: "Previously accepted, showing up again", cls: "bg-[#e7f7ef] text-[#067647]" },
  3: { label: "T3 Denied before", title: "Previously denied, showing up again", cls: "bg-[#fde8e8] text-[#b42318]" },
  4: { label: "T4 N/A before", title: "Previously marked N/A, showing up again", cls: "bg-[#f1f5f9] text-[#475569]" },
};

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
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
          <input
            type="text"
            defaultValue={search}
            onChange={(e) => {
              clearTimeout((window as any).__findSearch);
              (window as any).__findSearch = setTimeout(() => updateParams({ search: e.target.value }), 400);
            }}
            placeholder="Search findings…"
            className="w-full pl-9 pr-4 py-2 text-sm border border-[#e2e8f0] rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#0f172a]/10"
          />
        </div>
        <select value={severityFilter} onChange={(e) => updateParams({ severity: e.target.value })}
          className="text-sm border border-[#e2e8f0] rounded-lg px-3 py-2 bg-white">
          <option value="all">All Severity</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <select value={statusFilter} onChange={(e) => updateParams({ status: e.target.value })}
          className="text-sm border border-[#e2e8f0] rounded-lg px-3 py-2 bg-white">
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="in_review">Under Review</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Denied</option>
          <option value="na">N/A</option>
        </select>
        <CategoryMultiSelect categories={categories} selected={categoryFilter} onChange={(v) => updateParams({ category: v })} />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#f4f6f8] border-b border-[#e2e8f0]">
                <th className="px-3 py-2.5 text-left font-medium text-[#475569] text-xs w-6" />
                <th className="px-3 py-2.5 text-left font-medium text-[#475569] text-xs">Finding</th>
                <th className="px-3 py-2.5 text-left font-medium text-[#475569] text-xs">Category</th>
                <th className="px-3 py-2.5 text-left font-medium text-[#475569] text-xs">Charge Item</th>
                <th className="px-3 py-2.5 text-left font-medium text-[#475569] text-xs">Status</th>
                <th className="px-3 py-2.5 text-right font-medium text-[#475569] text-xs">Impact</th>
                <th className="px-3 py-2.5 text-left font-medium text-[#475569] text-xs w-8" />
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}
                  onClick={() => setSelected(f)}
                  className="border-b border-[#f1f5f9] hover:bg-[#f4f6f8] cursor-pointer transition-colors">
                  <td className="px-3 py-2.5"><SeverityDot severity={f.severity} /></td>
                  <td className="px-3 py-2.5 max-w-[350px]">
                    <div className="text-[#334155] font-medium truncate">{f.title}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge>{f.category}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[#64748b]">
                    {f.charge_items ? (
                      <span>{f.charge_items.procedure_number} — {f.charge_items.hcpcs_cpt_code || "No CPT"}</span>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant={statusVariant(f.status)}>{statusLabel(f.status)}</Badge>
                      {f.tier && TIER_META[f.tier] && <span title={TIER_META[f.tier].title} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${TIER_META[f.tier].cls}`}>{TIER_META[f.tier].label}</span>}
                      {f.is_carried && <span title={f.resolution_note || "Carried from a prior review"} className="text-[10px] font-semibold text-[#8a5a1a] bg-[#fef4e6] px-1.5 py-0.5 rounded">CARRIED</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-[#475569]">
                    {f.financial_impact ? `$${f.financial_impact.toLocaleString()}` : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <ChevronRight size={14} className="text-[#c5c5c0]" />
                  </td>
                </tr>
              ))}
              {findings.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-[#94a3b8] text-sm">
                    No findings match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#e2e8f0] bg-[#f4f6f8]">
          <span className="text-xs text-[#94a3b8]">{total.toLocaleString()} findings • Page {page} of {totalPages || 1}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => updateParams({ page: String(Math.max(1, page - 1)) })} disabled={page <= 1}
              className="px-3 py-1 text-xs border border-[#e2e8f0] rounded-lg hover:bg-white disabled:opacity-40">Prev</button>
            <button onClick={() => updateParams({ page: String(Math.min(totalPages, page + 1)) })} disabled={page >= totalPages}
              className="px-3 py-1 text-xs border border-[#e2e8f0] rounded-lg hover:bg-white disabled:opacity-40">Next</button>
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
  const [note, setNote] = useState(finding.resolution_note || "");
  const router = useRouter();

  const updateStatus = async (newStatus: string) => {
    setUpdating(true);
    try {
      const res = await fetch("/api/findings/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: finding.id, status: newStatus, note }),
      });
      if (res.ok) { setCurrentStatus(newStatus); router.refresh(); }
    } catch { /* ignore */ } finally { setUpdating(false); }
  };

  const DISPOSITIONS: { value: string; label: string }[] = [
    { value: "open", label: "Open" },
    { value: "in_review", label: "Under Review" },
    { value: "accepted", label: "Accepted" },
    { value: "rejected", label: "Denied" },
    { value: "na", label: "N/A" },
  ];

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col overflow-hidden animate-slide-in">
        <style>{`@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}.animate-slide-in{animation:slideIn .2s ease-out}`}</style>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e2e8f0]">
          <div className="flex items-center gap-2">
            <SeverityDot severity={finding.severity} />
            <Badge variant={
              finding.severity === "critical" ? "danger" :
              finding.severity === "high" ? "warning" : "default"
            }>
              {finding.severity}
            </Badge>
            <Badge variant={statusVariant(currentStatus)}>{statusLabel(currentStatus)}</Badge>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-[#f1f5f9] rounded-lg"><X size={18} /></button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-[#0f172a] leading-snug">{finding.title}</h3>
            {finding.category && (
              <div className="mt-2"><Badge>{finding.category}</Badge></div>
            )}
          </div>

          {/* Charge Item Info */}
          {finding.charge_items && (
            <div className="p-4 bg-[#f1f5f9] rounded-xl space-y-2">
              <div className="text-xs font-medium text-[#64748b]">Affected Charge Item</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-xs text-[#94a3b8]">Proc #</span>
                  <div className="font-mono text-[#0f172a]">{finding.charge_items.procedure_number}</div>
                </div>
                <div>
                  <span className="text-xs text-[#94a3b8]">HCPCS/CPT</span>
                  <div className="font-mono text-[#0f172a]">{finding.charge_items.hcpcs_cpt_code || "—"}</div>
                </div>
                <div>
                  <span className="text-xs text-[#94a3b8]">Rev Code</span>
                  <div className="font-mono text-[#0f172a]">{finding.charge_items.revenue_code}</div>
                </div>
                <div>
                  <span className="text-xs text-[#94a3b8]">Price</span>
                  <div className="font-mono text-[#0f172a]">${Number(finding.charge_items.gross_charge).toLocaleString()}</div>
                </div>
              </div>
              <div>
                <span className="text-xs text-[#94a3b8]">Description</span>
                <div className="text-sm text-[#334155]">{finding.charge_items.charge_description}</div>
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
              <div className="text-xs font-medium text-[#64748b] mb-1.5">Issue Details</div>
              <div className="text-sm text-[#334155] leading-relaxed">{finding.description}</div>
            </div>
          )}

          {/* Recommendation */}
          {finding.recommendation && (
            <div>
              <div className="text-xs font-medium text-[#64748b] mb-1.5">Recommendation</div>
              <div className="text-sm text-[#334155] leading-relaxed p-3 bg-blue-50 border border-blue-200 rounded-xl">
                {finding.recommendation}
              </div>
            </div>
          )}

          {/* Applied CDM change (for resolved findings that wrote a fix) */}
          {finding.applied_field && (
            <div>
              <div className="text-xs font-medium text-[#64748b] mb-1.5">Applied to CDM</div>
              <div className="text-sm text-[#334155] p-3 bg-[#eef2ff] border border-[#c7d2fe] rounded-xl">
                <b>{FIELD_LABELS[finding.applied_field] || finding.applied_field}</b>: <span className="font-mono">{finding.applied_old || "—"}</span> → <span className="font-mono text-[#2563eb] font-semibold">{finding.applied_new}</span>
                {finding.resolution_note && <div className="text-xs text-[#64748b] mt-1.5">Note: {finding.resolution_note}</div>}
              </div>
            </div>
          )}
        </div>

        {/* Disposition (present-only — no file edits yet) */}
        <div className="px-5 py-4 border-t border-[#e2e8f0] bg-[#f8fafc] space-y-3">
          <div>
            <div className="text-xs font-medium text-[#64748b] mb-1.5">Disposition</div>
            <div className="flex flex-wrap gap-1.5">
              {DISPOSITIONS.map((d) => (
                <button key={d.value} onClick={() => updateStatus(d.value)} disabled={updating}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border disabled:opacity-50 ${currentStatus === d.value ? "bg-[#2563eb] text-white border-[#2563eb]" : "bg-white text-[#475569] border-[#e2e8f0] hover:bg-[#f1f5f9]"}`}>
                  {d.label}
                </button>
              ))}
              {updating && <Loader2 size={14} className="animate-spin text-[#94a3b8] self-center ml-1" />}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#64748b] mb-1">Reviewer note (saved with the disposition)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Formulary item — route to pharmacy, not a CDM change." className="w-full text-sm border border-[#e2e8f0] rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Multi-select category filter ────────────────────────────
function CategoryMultiSelect({ categories, selected, onChange }: { categories: string[]; selected: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const chosen = (selected && selected !== "all") ? selected.split(",").map((c) => c.trim()).filter(Boolean) : [];
  const toggle = (c: string) => {
    const next = chosen.includes(c) ? chosen.filter((x) => x !== c) : [...chosen, c];
    onChange(next.length ? next.join(",") : "all");
  };
  const label = chosen.length === 0 ? "All Categories" : chosen.length === 1 ? chosen[0] : `${chosen.length} categories`;
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="text-sm border border-[#e2e8f0] rounded-lg px-3 py-2 bg-white flex items-center gap-2 min-w-[160px] justify-between">
        <span className="truncate max-w-[200px]">{label}</span>
        <ChevronRight size={14} className={`text-[#94a3b8] transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 w-64 max-h-72 overflow-y-auto bg-white border border-[#e2e8f0] rounded-lg shadow-lg py-1">
            <button onClick={() => { onChange("all"); }} className="w-full text-left px-3 py-1.5 text-sm text-[#2563eb] hover:bg-[#f1f5f9]">Clear all</button>
            {categories.map((c) => (
              <label key={c} className="flex items-center gap-2 px-3 py-1.5 text-sm text-[#334155] hover:bg-[#f1f5f9] cursor-pointer">
                <input type="checkbox" checked={chosen.includes(c)} onChange={() => toggle(c)} />
                <span className="truncate">{c}</span>
              </label>
            ))}
            {categories.length === 0 && <div className="px-3 py-2 text-xs text-[#94a3b8]">No categories</div>}
          </div>
        </>
      )}
    </div>
  );
}
