"use client";

import { useState } from "react";
import { FACILITY_TYPES, type FacilityType } from "@/lib/rule-catalog";
import { Loader2, Check } from "lucide-react";

// Entity-level facility type. Set once here; every new review inherits it and
// the rule set is chosen automatically, so it isn't picked per review.
export function FacilityTypeSetting({ initial }: { initial: FacilityType }) {
  const [value, setValue] = useState<FacilityType>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (v: FacilityType) => {
    setValue(v); setSaving(true); setSaved(false); setErr(null);
    try {
      const res = await fetch("/api/org/facility", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facilityType: v }),
      });
      const j = await res.json();
      if (!res.ok) { setErr(j.error || "Could not save"); return; }
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch (e: any) { setErr(e.message); } finally { setSaving(false); }
  };

  const note = FACILITY_TYPES.find((f) => f.value === value)?.note;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-[#64748b]">Facility type</span>
        <div className="flex items-center gap-2">
          {saving && <Loader2 size={14} className="animate-spin text-[#94a3b8]" />}
          {saved && <span className="inline-flex items-center gap-1 text-[12px] text-[#067647]"><Check size={13} /> Saved</span>}
          <select value={value} onChange={(e) => save(e.target.value as FacilityType)} disabled={saving}
            className="text-sm border border-[#e2e8f0] rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20">
            {FACILITY_TYPES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
      </div>
      {note && <p className="text-xs text-[#94a3b8] mt-2">{note} Applied to every new review for this entity.</p>}
      {err && <p className="text-xs text-[#b42318] mt-1">{err}</p>}
    </div>
  );
}
