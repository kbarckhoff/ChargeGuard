import type { Scorecard, Band } from "@/lib/scorecard";
import { PRODUCT } from "@/lib/product";

const money = (n: number) => {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
};

// Calm, semantic palette (Vanta/Linear register): one indigo accent, muted
// status tones, lots of neutral. No loud fills.
const INK = "#1a1a2e";       // near-black headings
const MUTE = "#6b7280";      // secondary text
const LINE = "#ececf1";      // hairline border
const ACCENT = "#4f46e5";    // indigo accent
const BAND_HEX: Record<Band, string> = {
  strong: "#15803d", ok: "#0e7490", risk: "#b45309", crit: "#be123c", pending: "#9ca3af",
};
const BAND_SOFT: Record<Band, string> = {
  strong: "#f0fdf4", ok: "#ecfeff", risk: "#fffbeb", crit: "#fff1f2", pending: "#f8fafc",
};
const BAND_LABEL: Record<Band, string> = {
  strong: "Strong", ok: "Adequate", risk: "At risk", crit: "Critical", pending: "Pending data",
};

export function ScorecardView({ sc, facility, period }: { sc: Scorecard; facility: string; period: string }) {
  const overallHex = BAND_HEX[sc.overallBand];
  const pct = sc.overall ?? 0;
  const circ = 2 * Math.PI * 54;
  const totalFindings = sc.opportunity.byCategory.reduce((s, c) => s + c.count, 0);

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: ACCENT }}>{PRODUCT.name}</span>
            <span className="text-[11px] text-[#c4c4cf]">/</span>
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#9ca3af]">Revenue Cycle Health</span>
          </div>
          <h1 className="text-[28px] font-semibold tracking-tight" style={{ color: INK }}>State of the Revenue Cycle</h1>
          <p className="text-[13px] text-[#6b7280] mt-1">{facility} · {period} · Diagnostic v1</p>
        </div>
        <div className="text-right">
          <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-medium"
            style={{ borderColor: LINE, color: sc.firstPassYield == null ? "#b45309" : "#15803d", background: sc.firstPassYield == null ? "#fffbeb" : "#f0fdf4" }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: sc.firstPassYield == null ? "#f59e0b" : "#22c55e" }} />
            {sc.firstPassYield == null ? "CDM · R&U ingested · claims pending" : "All four files ingested"}
          </span>
        </div>
      </div>

      {/* Hero: ring gauge + metric rail */}
      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 mb-10">
        <div className="rounded-2xl border bg-white p-7 flex flex-col items-center justify-center" style={{ borderColor: LINE }}>
          <div className="relative w-[148px] h-[148px]">
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r="54" fill="none" stroke="#f1f1f5" strokeWidth="9" />
              {sc.overall != null && (
                <circle cx="60" cy="60" r="54" fill="none" stroke={overallHex} strokeWidth="9" strokeLinecap="round"
                  strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)} />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[44px] font-semibold leading-none" style={{ color: INK }}>{sc.overall ?? "—"}</span>
              <span className="text-[12px] text-[#9ca3af] mt-0.5">out of 100</span>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="text-[22px] font-semibold" style={{ color: overallHex }}>{sc.overallGrade}</span>
            <span className="rounded-full px-2.5 py-0.5 text-[12px] font-medium" style={{ background: BAND_SOFT[sc.overallBand], color: overallHex }}>
              {BAND_LABEL[sc.overallBand]}
            </span>
          </div>
          <p className="text-[12px] text-[#9ca3af] mt-2 text-center leading-relaxed">Weighted across scored functional areas by dollar exposure</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-px rounded-2xl border overflow-hidden" style={{ borderColor: LINE, background: LINE }}>
          <Metric k="Net opportunity" v={money(sc.opportunity.netTotal)} n="annual, net realizable" accent="#15803d" />
          <Metric k="Cost of inaction" v={money(sc.opportunity.costOfInaction.dailyLeak * 365)} n="recurring annual leak" accent="#be123c" />
          <Metric k="Findings" v={totalFindings.toLocaleString()} n="across the rule set" />
          <Metric k="First-pass yield" v={sc.firstPassYield == null ? "—" : `${sc.firstPassYield}%`} n={sc.firstPassYield == null ? "awaiting 835" : "clean-claim rate"} />
          <Metric k="Denial rate" v={sc.denialRate == null ? "—" : `${sc.denialRate}%`} n={sc.denialRate == null ? "awaiting 835" : "by denied $"} />
          <Metric k="Net collection yield" v={sc.netCollectionYield == null ? "—" : `${sc.netCollectionYield}%`} n={sc.netCollectionYield == null ? "awaiting 835" : "paid ÷ allowed"} />
        </div>
      </div>

      {/* Functional areas */}
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-[15px] font-semibold" style={{ color: INK }}>Functional areas</h2>
        <span className="text-[12px] text-[#9ca3af]">front-end → middle → back-end</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sc.areas.map((a) => {
          const hex = BAND_HEX[a.band];
          return (
            <div key={a.name} className="group rounded-xl border bg-white p-5 transition-shadow hover:shadow-[0_1px_12px_rgba(17,17,40,0.06)]" style={{ borderColor: LINE }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[14.5px] font-semibold" style={{ color: INK }}>{a.name}</div>
                  <div className="text-[11.5px] text-[#9ca3af] mt-0.5">{a.stage}</div>
                </div>
                {a.score == null ? (
                  <span className="shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ background: BAND_SOFT.pending, color: BAND_HEX.pending }}>Pending</span>
                ) : (
                  <div className="shrink-0 flex items-center gap-2">
                    <span className="text-[24px] font-semibold tabular-nums" style={{ color: INK }}>{a.score}</span>
                    <span className="rounded-md px-1.5 py-0.5 text-[12px] font-semibold" style={{ background: BAND_SOFT[a.band], color: hex }}>{a.grade}</span>
                  </div>
                )}
              </div>

              {a.score == null ? (
                <p className="text-[12.5px] text-[#9ca3af] leading-relaxed mt-3">Unlocks when the 835 remittance and 837 claim files are ingested.</p>
              ) : (
                <>
                  <div className="h-1.5 rounded-full bg-[#f1f1f5] overflow-hidden mt-3.5 mb-3">
                    <span className="block h-full rounded-full transition-all" style={{ width: `${a.score}%`, background: hex }} />
                  </div>
                  <div className="text-[12.5px] text-[#4b5563] leading-relaxed">
                    {a.drivers.length ? a.drivers.map((d, i) => (
                      <span key={d.label}>{i > 0 && <span className="text-[#d1d5db]"> · </span>}<span className="font-medium" style={{ color: INK }}>{d.label}</span> {d.count}{d.net > 0 ? ` (${money(d.net)})` : ""}</span>
                    )) : <span className="text-[#9ca3af]">No material findings in this area.</span>}
                  </div>
                  <div className="flex items-center justify-between mt-3.5 pt-3 border-t text-[12px]" style={{ borderColor: LINE }}>
                    <span className="font-semibold" style={{ color: "#15803d" }}>{money(a.netOpp)} net opp</span>
                    <span className="text-[#9ca3af]">{a.source}</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Methodology */}
      <div className="rounded-xl border bg-[#fafafb] p-6 mt-8" style={{ borderColor: LINE }}>
        <div className="text-[13px] font-semibold mb-2" style={{ color: INK }}>How each score is computed</div>
        <p className="text-[12.5px] text-[#6b7280] leading-relaxed max-w-3xl">
          Each area is scored 0–100 from the engine&apos;s findings — the net-realizable opportunity and finding density attributed to that function — then rolled up into an overall grade weighted by dollar exposure. Every score carries its net opportunity and top drivers, so a grade always points to a specific, quantified fix. The engine quantifies; the consultant decides what&apos;s real.
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Legend hex="#15803d" soft="#f0fdf4" label="90–100 · A · Strong" />
          <Legend hex="#0e7490" soft="#ecfeff" label="80–89 · B · Adequate" />
          <Legend hex="#b45309" soft="#fffbeb" label="65–79 · C · At risk" />
          <Legend hex="#be123c" soft="#fff1f2" label="<65 · D/F · Critical" />
        </div>
      </div>
      <p className="text-[11.5px] text-[#9ca3af] mt-4 text-center">Computed live by the {PRODUCT.name} engine from the facility&apos;s own files. Areas needing 835/837 data stay pending until those files are ingested.</p>
    </div>
  );
}

function Metric({ k, v, n, accent }: { k: string; v: string; n: string; accent?: string }) {
  return (
    <div className="bg-white p-5">
      <div className="text-[11.5px] font-medium text-[#9ca3af]">{k}</div>
      <div className="text-[24px] font-semibold mt-1.5 tabular-nums" style={{ color: accent || INK }}>{v}</div>
      <div className="text-[11.5px] text-[#9ca3af] mt-0.5">{n}</div>
    </div>
  );
}

function Legend({ hex, soft, label }: { hex: string; soft: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium" style={{ background: soft, color: hex }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: hex }} />{label}
    </span>
  );
}
