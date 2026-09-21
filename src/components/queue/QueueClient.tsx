"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, SeverityDot } from "@/components/ui/shared";
import { Loader2, Check, ChevronDown } from "lucide-react";

type Row = {
  id: string; title: string; description: string; category: string; severity: string; status: string;
  financial_impact: number | null; recommendation: string; resolution_note: string | null;
  charge_items: { procedure_number: string; hcpcs_cpt_code: string; charge_description: string; gross_charge: number } | null;
};

const STATUS_LABEL: Record<string, string> = { open: "Open", in_review: "Under Review", accepted: "Accepted", rejected: "Denied", na: "N/A", resolved: "Accepted" };
const variant = (s: string): any => s === "accepted" || s === "resolved" ? "success" : s === "rejected" ? "danger" : s === "na" ? "default" : "default";

export function QueueClient({ rows }: { rows: Row[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!rows.length) {
    return <div className="bg-white rounded-xl border border-[#e2e8f0] p-10 text-center text-[#94a3b8] text-sm">Nothing assigned to you right now. When the Charge Master Analyst assigns you a finding, it shows up here.</div>;
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.id} className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
          <button onClick={() => setOpenId(openId === r.id ? null : r.id)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-[#f8fafc]">
            <SeverityDot severity={r.severity} />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium text-[#0f172a] truncate">{r.title}</div>
              <div className="text-[12px] text-[#94a3b8] truncate">
                {r.charge_items ? `${r.charge_items.procedure_number} · ${r.charge_items.hcpcs_cpt_code || "No CPT"} · ` : ""}{r.category}
              </div>
            </div>
            <Badge variant={variant(r.status)}>{STATUS_LABEL[r.status] || r.status}</Badge>
            <ChevronDown size={16} className={`text-[#94a3b8] transition-transform ${openId === r.id ? "rotate-180" : ""}`} />
          </button>
          {openId === r.id && <ActionPanel row={r} />}
        </div>
      ))}
    </div>
  );
}

function ActionPanel({ row }: { row: Row }) {
  const router = useRouter();
  const [note, setNote] = useState(row.resolution_note || "");
  const [actionTaken, setActionTaken] = useState("");
  const [effDate, setEffDate] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");

  const submit = async (status: string) => {
    if (!note.trim()) { setErr("A note is required."); return; }
    setBusy(status); setErr("");
    try {
      const res = await fetch("/api/findings/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId: row.id, status, note, action_taken: actionTaken, effective_date: effDate }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Could not save"); setBusy(""); return; }
      setDone(status === "rejected" ? "Denied" : status === "na" ? "Marked N/A" : "Accepted");
      setBusy(""); router.refresh();
    } catch (e: any) { setErr(e?.message || "Something went wrong"); setBusy(""); }
  };

  const inp = "w-full text-sm border border-[#e2e8f0] rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20";
  return (
    <div className="border-t border-[#eef2f7] bg-[#f8fafc] px-4 py-4 space-y-3">
      <div className="grid md:grid-cols-2 gap-3">
        <div className="p-3 bg-white rounded-lg border border-[#eef2f7] text-[13px]">
          <div className="text-[11px] text-[#94a3b8] mb-1">Issue</div>
          <div className="text-[#334155]">{row.description || row.title}</div>
        </div>
        {row.recommendation && (
          <div className="p-3 bg-white rounded-lg border border-[#eef2f7] text-[13px]">
            <div className="text-[11px] text-[#94a3b8] mb-1">Recommendation</div>
            <div className="text-[#334155]">{row.recommendation}</div>
          </div>
        )}
      </div>

      {err && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{err}</div>}
      {done && <div className="p-2.5 bg-[#e7f7ef] border border-[#bbe9d1] rounded-lg text-[13px] text-[#067647] inline-flex items-center gap-1.5"><Check size={13} /> {done}. Saved to the audit log.</div>}

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[12px] font-medium text-[#475569] mb-1">Note / rationale <span className="text-[#b45309]">*</span></label>
          <textarea className={inp} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why you're accepting or denying this." />
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[12px] font-medium text-[#475569] mb-1">Action taken</label>
            <input className={inp} value={actionTaken} onChange={(e) => setActionTaken(e.target.value)} placeholder="e.g. Updated rev code to 0636 in EHR" />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[#475569] mb-1">Effective date</label>
            <input type="date" className={inp} value={effDate} onChange={(e) => setEffDate(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => submit("accepted")} disabled={!!busy} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-[#067647] text-white hover:bg-[#055c37] disabled:opacity-50 inline-flex items-center gap-1.5">{busy === "accepted" && <Loader2 size={13} className="animate-spin" />} Accept</button>
        <button onClick={() => submit("rejected")} disabled={!!busy} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-[#b42318] text-white hover:bg-[#95170e] disabled:opacity-50 inline-flex items-center gap-1.5">{busy === "rejected" && <Loader2 size={13} className="animate-spin" />} Reject</button>
        <button onClick={() => submit("na")} disabled={!!busy} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-white border border-[#e2e8f0] text-[#475569] hover:bg-[#f1f5f9] disabled:opacity-50 inline-flex items-center gap-1.5">{busy === "na" && <Loader2 size={13} className="animate-spin" />} N/A</button>
      </div>
    </div>
  );
}
