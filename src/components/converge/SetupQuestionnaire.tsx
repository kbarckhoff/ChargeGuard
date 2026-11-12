"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SETUP_FACTS, missingRequiredFacts, type SetupFacts } from "@/lib/setup-questionnaire";
import { Check, Loader2, Lock } from "lucide-react";

export function SetupQuestionnaire({ auditId, initial }: { auditId: string; initial: SetupFacts }) {
  const router = useRouter();
  const [facts, setFacts] = useState<SetupFacts>({ ...initial });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");

  const set = (id: string, v: string | boolean) => { setFacts((f) => ({ ...f, [id]: v })); setSaved(false); };
  const missing = missingRequiredFacts(facts);

  const save = async () => {
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/audits/setup-facts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId, facts }) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Could not save"); setSaving(false); return; }
      setSaved(true); setSaving(false); router.refresh();
    } catch (e: any) { setErr(e?.message || "Something went wrong"); setSaving(false); }
  };

  const inp = "w-full h-10 border border-[#e2e8f0] rounded-lg px-3 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#1e293b]/20";

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[#0f172a]">Setup questionnaire</h2>
        <p className="text-[13px] text-[#64748b] mt-0.5">The facility facts no data file contains. A missing required fact blocks its rules rather than producing a wrong number.</p>
      </div>

      {missing.length > 0 && (
        <div className="rounded-xl border border-[#f5d99a] bg-[#fff8ec] p-4">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[#8a5a1a] mb-1"><Lock size={14} /> {missing.length} required fact{missing.length === 1 ? "" : "s"} still needed</div>
          <div className="text-[12.5px] text-[#8a5a1a]/90">Until answered, these are blocked: {missing.map((m) => m.gates).join("; ")}.</div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e2e8f0] divide-y divide-[#f1f5f9]">
        {SETUP_FACTS.map((f) => (
          <div key={f.id} className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <label className="text-[13.5px] font-medium text-[#0f172a]">{f.label}</label>
              {f.required && <span className="text-[10px] font-semibold text-[#b45309] bg-[#fef4e6] px-1.5 py-0.5 rounded">Required</span>}
            </div>
            <p className="text-[12px] text-[#94a3b8] mb-2">{f.help} <span className="text-[#cbd5e1]">· Gates: {f.gates}</span></p>
            {f.type === "select" && (
              <select className={inp} value={(facts[f.id] as string) || ""} onChange={(e) => set(f.id, e.target.value)}>
                <option value="">Select…</option>
                {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
            {f.type === "text" && (
              <input className={inp} value={(facts[f.id] as string) || ""} onChange={(e) => set(f.id, e.target.value)} placeholder="Enter a value" />
            )}
            {f.type === "boolean" && (
              <div className="flex gap-2">
                {[["true", "Yes"], ["false", "No"]].map(([v, l]) => (
                  <button key={v} onClick={() => set(f.id, v === "true")}
                    className={`px-4 h-9 rounded-lg text-[13px] font-medium border ${String(facts[f.id]) === v ? "bg-[#1e293b] text-white border-[#1e293b]" : "bg-white text-[#475569] border-[#e2e8f0] hover:bg-[#f1f5f9]"}`}>{l}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {err && <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg text-[13px] text-red-700">{err}</div>}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1e293b] text-white rounded-lg text-[13px] font-medium hover:bg-[#0f172a] disabled:opacity-50">
          {saving ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null} {saved ? "Saved" : "Save setup facts"}
        </button>
        {saved && <span className="text-[12.5px] text-[#067647]">Saved to this review.</span>}
      </div>
    </div>
  );
}
