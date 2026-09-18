"use client";

import { useState, useRef } from "react";
import { Loader2, Check } from "lucide-react";
import { catalogForFacility, RULE_CATALOG, type FacilityType } from "@/lib/rule-catalog";

// Intake control: list the checks the scan runs for the selected facility type,
// grouped by area, with a toggle per check. All on by default. Turning one off
// adds its rule_ids to the audit's disabled_rules; the scan skips those. The
// list itself is scoped to the facility type (e.g. inpatient hides OPPS rules).
export function RuleSettings({ auditId, initialDisabled, locked, facilityType }: { auditId: string; initialDisabled?: string[]; locked?: boolean; facilityType?: FacilityType }) {
  const catalog = facilityType ? catalogForFacility(facilityType) : RULE_CATALOG;
  const [disabled, setDisabled] = useState<Set<string>>(new Set(initialDisabled || []));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timer = useRef<any>(null);

  const persist = (next: Set<string>) => {
    setSaving(true); setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await fetch("/api/audits/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ auditId, disabledRules: Array.from(next) }) });
        setSaved(true);
      } catch { /* ignore */ } finally { setSaving(false); }
    }, 500);
  };

  const isOn = (ids: string[]) => !ids.some((id) => disabled.has(id));
  const toggle = (ids: string[]) => {
    if (locked) return;
    setDisabled((prev) => {
      const next = new Set(prev);
      const wasOn = !ids.some((id) => next.has(id));
      if (wasOn) ids.forEach((id) => next.add(id));
      else ids.forEach((id) => next.delete(id));
      persist(next);
      return next;
    });
  };
  const setAll = (on: boolean) => {
    if (locked) return;
    const next = new Set<string>();
    if (!on) catalog.forEach((g) => g.items.forEach((i) => i.ids.forEach((id) => next.add(id))));
    setDisabled(next); persist(next);
  };

  const total = catalog.reduce((n, g) => n + g.items.length, 0);
  const active = catalog.reduce((n, g) => n + g.items.filter((i) => isOn(i.ids)).length, 0);

  return (
    <div className="bg-white rounded-2xl border border-[#edf0f4] p-6 shadow-[0_1px_2px_rgba(16,24,40,0.04)] mb-4">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div>
          <h3 className="text-[15px] font-bold text-[#111827]">Active rules</h3>
          <p className="text-[13px] text-[#6b7280] mt-0.5">Every check the review runs. All are on by default. Turn off any you don't want for this engagement.</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[12px] text-[#6b7280]">{saving ? <span className="inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> saving</span> : saved ? <span className="inline-flex items-center gap-1 text-[#067647]"><Check size={12} /> saved</span> : ""}</span>
          <span className="text-[12px] font-semibold text-[#1e293b] bg-[#eef2ff] px-2.5 py-1 rounded-full">{active}/{total} on</span>
        </div>
      </div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setAll(true)} className="text-[12px] font-medium text-[#1e293b] hover:underline">Enable all</button>
        <span className="text-[#d1d5db]">·</span>
        <button onClick={() => setAll(false)} className="text-[12px] font-medium text-[#6b7280] hover:underline">Disable all</button>
      </div>

      <div className="space-y-5">
        {catalog.map((g) => (
          <div key={g.group}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9aa2af] mb-2">{g.group}</div>
            <div className="grid grid-cols-1 gap-2">
              {g.items.map((it) => {
                const on = isOn(it.ids);
                return (
                  <div key={it.key} className="flex items-start justify-between gap-3 border border-[#edf0f4] rounded-xl px-3 py-2.5">
                    <div className="min-w-0">
                      <div className={`text-[13px] font-medium ${on ? "text-[#111827]" : "text-[#9aa2af]"}`}>{it.name}</div>
                      <div className="text-[11.5px] text-[#9aa2af] leading-snug mt-0.5">{it.desc}</div>
                    </div>
                    <button onClick={() => toggle(it.ids)} disabled={locked} aria-label={`Toggle ${it.name}`} className={`relative w-9 h-5 rounded-full shrink-0 mt-0.5 transition-colors ${on ? "bg-[#1e293b]" : "bg-[#d1d5db]"} ${locked ? "opacity-50 cursor-not-allowed" : ""}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
