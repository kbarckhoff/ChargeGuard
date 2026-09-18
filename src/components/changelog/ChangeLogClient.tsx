"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Pencil, Plus, Loader2 } from "lucide-react";

type Entry = {
  id: string; change_number: number | null; audit_id: string | null;
  procedure_number: string | null; hcpcs: string | null; description: string | null;
  action_type: string; field: string | null; old_value: string | null; new_value: string | null;
  rationale: string | null; status: string; effective_date: string | null; approver_name: string | null;
  source?: string | null;
};
type Review = { id: string; name: string };

const STATUS_STYLE: Record<string, string> = {
  logged: "text-[#3730a3] bg-[#eef2ff]",
  pending: "text-[#8a5a1a] bg-[#fef4e6]",
  exported: "text-[#1e293b] bg-[#eff4ff]",
  approved_missing: "text-[#b42318] bg-[#fdeceb]",
  implemented: "text-[#067647] bg-[#e7f7ef]",
  void: "text-[#94a3b8] bg-[#f1f5f9]",
};
const STATUS_LABEL: Record<string, string> = {
  logged: "Logged", pending: "Pending", exported: "Exported",
  approved_missing: "Approved · missing", implemented: "Implemented", void: "Void",
};

export function ChangeLogClient({ entries, reviews, latestAuditId }: { entries: Entry[]; reviews: Review[]; latestAuditId: string | null }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState("active");
  const [reviewId, setReviewId] = useState(latestAuditId || "");
  const [busy, setBusy] = useState<string>("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [editDate, setEditDate] = useState("");
  const [showAdd, setShowAdd] = useState(false);

  const shown = entries.filter((e) => statusFilter === "all" ? true : statusFilter === "active" ? e.status !== "void" : statusFilter === "manual" ? e.source === "manual" : e.status === statusFilter);

  const post = async (url: string, body: any) => (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

  const voidEntry = async (id: string) => { setBusy(id); await post("/api/change-log/update", { id, status: "void" }); setBusy(""); router.refresh(); };
  const saveEdit = async (id: string) => { setBusy(id); await post("/api/change-log/update", { id, new_value: editVal, effective_date: editDate }); setBusy(""); setEditId(null); router.refresh(); };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#64748b]">Review</span>
          <select value={reviewId} onChange={(e) => setReviewId(e.target.value)} className="text-[13px] border border-[#e2e8f0] rounded-lg px-2 py-1.5">
            {reviews.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white bg-[#1e293b] hover:bg-[#0f172a]">
          <Plus size={14} /> Add manual entry
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[12px] text-[#64748b]">Show</span>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="text-[13px] border border-[#e2e8f0] rounded-lg px-2 py-1.5">
            <option value="active">Active (not void)</option>
            <option value="manual">Manual entries</option>
            <option value="logged">Logged</option>
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
            {shown.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-[#94a3b8]">No change-log entries. Accept a finding to stage a change, or add a manual entry to document a CDM update.</td></tr>}
            {shown.map((e) => (
              <tr key={e.id} className="border-b border-[#f1f5f9] align-top">
                <td className="px-3 py-2.5 text-[#94a3b8]">{e.change_number ?? "—"}</td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-[#0f172a]">{e.procedure_number || e.hcpcs || "—"}</span>
                    {e.source === "manual" && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#eef2ff] text-[#3730a3]">Manual</span>}
                  </div>
                  <div className="text-[11px] text-[#94a3b8] max-w-[180px] truncate">{e.description}</div>
                </td>
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
                <td className="px-3 py-2.5"><span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLE[e.status] || ""}`}>{STATUS_LABEL[e.status] || e.status}</span></td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {e.status !== "void" && (editId === e.id ? (
                    <span className="flex items-center gap-2">
                      <button onClick={() => saveEdit(e.id)} disabled={busy === e.id} className="text-[#1e293b]"><Check size={14} /></button>
                      <button onClick={() => setEditId(null)} className="text-[#94a3b8]"><X size={14} /></button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2.5">
                      <button onClick={() => { setEditId(e.id); setEditVal(e.new_value || ""); setEditDate(e.effective_date || ""); }} title="Edit" className="text-[#64748b] hover:text-[#1e293b]"><Pencil size={13} /></button>
                      <button onClick={() => voidEntry(e.id)} disabled={busy === e.id} className="text-[12px] text-[#b42318] hover:underline">Void</button>
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && <ManualEntryModal auditId={reviewId} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); router.refresh(); }} />}
    </div>
  );
}

// ─── Manual entry modal (documentation-only) ─────────────────
function ManualEntryModal({ auditId, onClose, onSaved }: { auditId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    procedure_number: "", hcpcs: "", description: "",
    action_type: "add", field: "", old_value: "", new_value: "",
    rationale: "", effective_date: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/change-log/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, auditId }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || "Could not save the entry."); setBusy(false); return; }
      onSaved();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  };

  const inp = "w-full h-9 border border-[#e2e8f0] rounded-lg px-2.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20";
  const lab = "block text-[12px] font-medium text-[#475569] mb-1";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && onClose()}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[88vh] overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#eef0f4]">
          <div>
            <h3 className="text-sm font-bold text-[#0f172a]">Add manual change-log entry</h3>
            <p className="text-[12px] text-[#94a3b8] mt-0.5">Documents a CDM update for the audit trail. This does not change findings or the analysis.</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#f1f5f9] text-[#94a3b8]"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          {err && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lab}>Charge / procedure #</label><input className={inp} value={f.procedure_number} onChange={(e) => set("procedure_number", e.target.value)} placeholder="e.g. 450123" /></div>
            <div><label className={lab}>HCPCS / CPT</label><input className={inp} value={f.hcpcs} onChange={(e) => set("hcpcs", e.target.value)} placeholder="e.g. 96372" /></div>
          </div>
          <div><label className={lab}>Description</label><input className={inp} value={f.description} onChange={(e) => set("description", e.target.value)} placeholder="e.g. New IV infusion service line" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lab}>Action</label>
              <select className={inp} value={f.action_type} onChange={(e) => set("action_type", e.target.value)}>
                <option value="add">Add</option><option value="modify">Modify</option><option value="deactivate">Deactivate</option>
              </select>
            </div>
            <div>
              <label className={lab}>Field changed</label>
              <select className={inp} value={f.field} onChange={(e) => set("field", e.target.value)}>
                <option value="">— (n/a)</option>
                <option value="price">Price</option><option value="description">Description</option>
                <option value="hcpcs">HCPCS/CPT</option><option value="revenue_code">Revenue code</option>
                <option value="modifier">Modifier</option><option value="status">Status</option><option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lab}>Old value</label><input className={inp} value={f.old_value} onChange={(e) => set("old_value", e.target.value)} placeholder="prior value (if any)" /></div>
            <div><label className={lab}>New value</label><input className={inp} value={f.new_value} onChange={(e) => set("new_value", e.target.value)} placeholder="new value" /></div>
          </div>
          <div><label className={lab}>Rationale <span className="text-[#b45309]">*</span></label><textarea className={inp + " h-auto py-2"} rows={2} value={f.rationale} onChange={(e) => set("rationale", e.target.value)} placeholder="Why this change was made (recorded for the audit trail)" /></div>
          <div><label className={lab}>Effective date</label><input type="date" className={inp} value={f.effective_date} onChange={(e) => set("effective_date", e.target.value)} /></div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[#eef0f4]">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-white border border-[#e2e8f0] text-[#374151] hover:bg-[#f6f7f9]">Cancel</button>
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-semibold bg-[#1e293b] text-white hover:bg-[#0f172a] disabled:opacity-50 flex items-center gap-2">{busy && <Loader2 size={14} className="animate-spin" />} Save entry</button>
        </div>
      </div>
    </div>
  );
}
