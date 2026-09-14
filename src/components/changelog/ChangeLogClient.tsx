"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, Loader2, Check, X, Pencil } from "lucide-react";

type Entry = {
  id: string; change_number: number | null; audit_id: string | null;
  procedure_number: string | null; hcpcs: string | null; description: string | null;
  action_type: string; field: string | null; old_value: string | null; new_value: string | null;
  rationale: string | null; status: string; effective_date: string | null; approver_name: string | null;
};
type Review = { id: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  pending: "text-[#8a5a1a] bg-[#fef4e6]",
  exported: "text-[#1f6fd4] bg-[#eff4ff]",
  implemented: "text-[#067647] bg-[#e7f7ef]",
  void: "text-[#94a3b8] bg-[#f1f5f9]",
};

export function ChangeLogClient({ entries, reviews, latestAuditId }: { entries: Entry[]; reviews: Review[]; latestAuditId: string | null }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("active");
  const [reviewId, setReviewId] = useState(latestAuditId || "");
  const [syncMsg, setSyncMsg] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [editDate, setEditDate] = useState("");

  const shown = entries.filter((e) => statusFilter === "all" ? true : statusFilter === "active" ? e.status !== "void" : e.status === statusFilter);

  const post = async (url: string, body: any) => (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

  const voidEntry = async (id: string) => { setBusy(id); await post("/api/change-log/update", { id, status: "void" }); setBusy(""); router.refresh(); };
  const saveEdit = async (id: string) => { setBusy(id); await post("/api/change-log/update", { id, new_value: editVal, effective_date: editDate }); setBusy(""); setEditId(null); router.refresh(); };
  const reconcile = async () => { if (!reviewId) return; setBusy("sync"); const r = await post("/api/change-log/sync", { auditId: reviewId, action: "reconcile" }); setBusy(""); setSyncMsg(`${r.implemented ?? 0} now implemented · ${r.missing ?? 0} still missing from this upload`); router.refresh(); };
  const reapply = async () => { if (!reviewId) return; setBusy("sync"); const r = await post("/api/change-log/sync", { auditId: reviewId, action: "reapply" }); setBusy(""); setSyncMsg(`${r.reapplied ?? 0} approved changes re-staged as pending on this review`); router.refresh(); };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#64748b]">Review</span>
          <select value={reviewId} onChange={(e) => setReviewId(e.target.value)} className="text-[13px] border border-[#e2e8f0] rounded-lg px-2 py-1.5">
            {reviews.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <a href={reviewId ? `/api/change-log/export?auditId=${reviewId}` : "#"} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white ${reviewId ? "bg-[#1f6fd4] hover:bg-[#1a5fb8]" : "bg-[#cbd5e1] pointer-events-none"}`}>
          <Download size={14} /> Generate Updated CDM
        </a>
        <button onClick={reconcile} disabled={!reviewId || busy === "sync"} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium bg-white border border-[#e2e8f0] text-[#334155] hover:bg-[#f6f7f9] disabled:opacity-50">
          {busy === "sync" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check EHR sync
        </button>
        <button onClick={reapply} disabled={!reviewId || busy === "sync"} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium bg-white border border-[#e2e8f0] text-[#334155] hover:bg-[#f6f7f9] disabled:opacity-50">
          Re-apply missing
        </button>
        {syncMsg && <span className="text-[12px] text-[#475569]">{syncMsg}</span>}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-[#64748b]">Show</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-[13px] border border-[#e2e8f0] rounded-lg px-2 py-1.5">
            <option value="active">Active (not void)</option>
            <option value="pending">Pending</option>
            <option value="exported">Exported</option>
            <option value="implemented">Implemented</option>
            <option value="void">Void</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-[#94a3b8] border-b border-[#e2e8f0]">
              <th className="px-3 py-2.5">#</th><th className="px-3 py-2.5">Line</th><th className="px-3 py-2.5">Action</th>
              <th className="px-3 py-2.5">Field</th><th className="px-3 py-2.5">Old → New</th><th className="px-3 py-2.5">Rationale</th>
              <th className="px-3 py-2.5">Approver</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-[#94a3b8]">No change-log entries. Accept a finding to stage a change here.</td></tr>}
            {shown.map((e) => (
              <tr key={e.id} className="border-b border-[#f1f5f9] align-top">
                <td className="px-3 py-2.5 text-[#94a3b8]">{e.change_number ?? "—"}</td>
                <td className="px-3 py-2.5"><div className="font-medium text-[#0f172a]">{e.procedure_number || e.hcpcs || "—"}</div><div className="text-[11px] text-[#94a3b8] max-w-[180px] truncate">{e.description}</div></td>
                <td className="px-3 py-2.5 capitalize">{e.action_type}</td>
                <td className="px-3 py-2.5 capitalize">{e.field}</td>
                <td className="px-3 py-2.5">
                  {editId === e.id ? (
                    <div className="flex flex-col gap-1">
                      <input value={editVal} onChange={(ev) => setEditVal(ev.target.value)} placeholder="new value" className="w-28 px-2 py-1 text-[12px] border border-[#e2e8f0] rounded" />
                      <input type="date" value={editDate} onChange={(ev) => setEditDate(ev.target.value)} className="w-32 px-2 py-1 text-[12px] border border-[#e2e8f0] rounded" />
                    </div>
                  ) : (
                    <span><span className="text-[#94a3b8]">{e.old_value ?? "—"}</span> → <span className="font-medium text-[#0f172a]">{e.new_value ?? "—"}</span></span>
                  )}
                </td>
                <td className="px-3 py-2.5 max-w-[240px]"><div className="text-[#475569] line-clamp-2">{e.rationale}</div></td>
                <td className="px-3 py-2.5 text-[#64748b]">{e.approver_name || "—"}</td>
                <td className="px-3 py-2.5"><span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded capitalize ${STATUS_STYLE[e.status] || ""}`}>{e.status}</span></td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {e.status !== "void" && (editId === e.id ? (
                    <span className="flex items-center gap-2">
                      <button onClick={() => saveEdit(e.id)} disabled={busy === e.id} className="text-[#1f6fd4]"><Check size={14} /></button>
                      <button onClick={() => setEditId(null)} className="text-[#94a3b8]"><X size={14} /></button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2.5">
                      <button onClick={() => { setEditId(e.id); setEditVal(e.new_value || ""); setEditDate(e.effective_date || ""); }} title="Edit" className="text-[#64748b] hover:text-[#1f6fd4]"><Pencil size={13} /></button>
                      <button onClick={() => voidEntry(e.id)} disabled={busy === e.id} className="text-[12px] text-[#b42318] hover:underline">Void</button>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
