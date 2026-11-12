import type { OpportunityModel, CategoryLine } from "@/lib/opportunity";

const money = (n: number) => {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
};
const full = (n: number) => `$${Math.round(n).toLocaleString()}`;

const CADENCE_LABEL: Record<string, string> = { recurring: "Recurring / yr", one_time: "One-time" };
const PHASE_LABEL: Record<string, string> = { phase_1: "Phase 1", phase_2: "Phase 2" };

export function OpportunityView({ model, hospitalName, reviewName }: { model: OpportunityModel; hospitalName: string; reviewName: string }) {
  const m = model;
  // Waterfall bars sized against the target total.
  const wfMax = Math.max(...m.waterfall.map((w) => Math.abs(w.amount)), 1);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h2 className="text-base font-semibold text-[#0f172a]">Opportunity</h2>
        <p className="text-[13px] text-[#64748b] mt-0.5">{hospitalName} · {reviewName}. Net-realizable estimate — conservative, not gross.</p>
      </div>

      {/* Headline cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
          <div className="text-xs text-[#64748b]">Net realizable opportunity</div>
          <div className="text-[26px] font-bold text-[#0f172a] mt-1 leading-none">{money(m.netTotal)}</div>
          <div className="text-[12px] text-[#94a3b8] mt-1.5">Gross identified {money(m.grossTotal)}</div>
          <div className="text-[12px] text-[#64748b] mt-1">Range {money(m.confidence.low)} – {money(m.confidence.high)}</div>
        </div>
        <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
          <div className="text-xs text-[#64748b]">Recurring vs one-time</div>
          <div className="text-[20px] font-bold text-[#0f172a] mt-1 leading-tight">{money(m.netRecurring)}<span className="text-[13px] font-medium text-[#94a3b8]"> / yr recurring</span></div>
          <div className="text-[13px] text-[#475569] mt-1">{money(m.netOneTime)} one-time</div>
          <div className="text-[12px] text-[#94a3b8] mt-1.5">Never blended — different budgets.</div>
        </div>
        <div className="bg-white rounded-xl border border-[#fde0d6] bg-[#fff8f5] p-5">
          <div className="text-xs text-[#b45309]">Cost of inaction</div>
          <div className="text-[20px] font-bold text-[#9a3412] mt-1 leading-tight">{full(m.costOfInaction.dailyLeak)}<span className="text-[13px] font-medium text-[#c2855f]"> / day</span></div>
          <div className="text-[12px] text-[#9a3412]/80 mt-1.5">{m.costOfInaction.complianceFindingCount.toLocaleString()} compliance-relevant findings at risk.</div>
        </div>
      </div>

      {/* Opportunity waterfall (also the phased roadmap) */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] p-5">
        <div className="text-[13.5px] font-semibold text-[#0f172a] mb-0.5">Opportunity waterfall</div>
        <p className="text-[12px] text-[#94a3b8] mb-4">Sequenced by speed-to-cash. Each step is its own workstream.</p>
        <div className="space-y-2.5">
          {m.waterfall.map((w, i) => {
            const isEnd = i === 0 || i === m.waterfall.length - 1;
            return (
              <div key={w.label} className="flex items-center gap-3">
                <div className="w-48 text-[12.5px] text-[#475569] shrink-0">{w.label}</div>
                <div className="flex-1 h-5 bg-[#f1f5f9] rounded overflow-hidden">
                  <div className={`h-full rounded ${isEnd ? "bg-[#1e293b]" : "bg-[#16a34a]"}`} style={{ width: `${Math.max(2, (Math.abs(w.amount) / wfMax) * 100)}%` }} />
                </div>
                <div className="w-24 text-right text-[12.5px] font-semibold text-[#0f172a] tabular-nums">{isEnd ? money(w.amount) : "+" + money(w.amount)}</div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-4 pt-3 border-t border-[#f1f5f9] text-[12.5px]">
          <span className="text-[#475569]"><span className="font-semibold text-[#0f172a]">{money(m.phase1Net)}</span> Phase 1 (quick wins)</span>
          <span className="text-[#475569]"><span className="font-semibold text-[#0f172a]">{money(m.phase2Net)}</span> Phase 2 (pricing & workstreams)</span>
        </div>
      </div>

      {/* By-category table */}
      <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-x-auto">
        <table className="w-full text-sm whitespace-nowrap">
          <thead>
            <tr className="bg-[#f4f6f8] border-b border-[#e2e8f0] text-left text-xs text-[#475569]">
              <th className="px-3 py-2.5 font-medium">Opportunity</th>
              <th className="px-3 py-2.5 font-medium text-right">Findings</th>
              <th className="px-3 py-2.5 font-medium text-right">Gross</th>
              <th className="px-3 py-2.5 font-medium text-right">Net realizable</th>
              <th className="px-3 py-2.5 font-medium">Cadence</th>
              <th className="px-3 py-2.5 font-medium">Phase</th>
            </tr>
          </thead>
          <tbody>
            {m.byCategory.filter((c: CategoryLine) => c.net > 0).map((c) => (
              <tr key={c.category} className="border-b border-[#f1f5f9]">
                <td className="px-3 py-2.5 text-[#0f172a]">{c.category}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[#475569]">{c.count.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-[#64748b]">{full(c.gross)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-[#0f172a]">{full(c.net)}</td>
                <td className="px-3 py-2.5 text-[#64748b]">{CADENCE_LABEL[c.cadence]}</td>
                <td className="px-3 py-2.5 text-[#64748b]">{PHASE_LABEL[c.phase]}</td>
              </tr>
            ))}
            {m.byCategory.filter((c) => c.net > 0).length === 0 && (
              <tr><td colSpan={6} className="px-3 py-10 text-center text-[#94a3b8] text-sm">No dollar-bearing opportunity yet. Run a review with a CDM + utilization file.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-[#94a3b8]">
        Net = gross × a conservative realization rate per fix type (coding fixes capture near-full; pricing is discounted pending payer mix and contracts). The engine quantifies; the consultant decides what's real.
      </p>
    </div>
  );
}
