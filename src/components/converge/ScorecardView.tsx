import type { Scorecard, Band } from "@/lib/scorecard";
import { PRODUCT } from "@/lib/product";

const money = (n: number) => {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
};

// Band → colors (Greg's palette: green / teal / amber / red / slate).
const BAND_HEX: Record<Band, string> = { strong: "#2F7A4D", ok: "#0E7C86", risk: "#C9881F", crit: "#A23B2A", pending: "#94a3b8" };
const NAVY = "#1F2A44", TEAL = "#0E7C86";

export function ScorecardView({ sc, facility, period }: { sc: Scorecard; facility: string; period: string }) {
  const overallHex = BAND_HEX[sc.overallBand];
  return (
    <div className="max-w-5xl mx-auto">
      {/* Top bar */}
      <div className="flex items-end justify-between border-b-[3px] pb-3 mb-5" style={{ borderColor: TEAL }}>
        <div>
          <div className="text-[26px] font-extrabold tracking-wide" style={{ color: NAVY }}>{PRODUCT.name.toUpperCase()}</div>
          <div className="text-[14px] font-semibold" style={{ color: TEAL }}>Revenue Cycle Health Scorecard — State of the Revenue Cycle</div>
        </div>
        <div className="text-right text-[12px] text-[#64748b] leading-relaxed">
          {facility} · {period} · Diagnostic v1<br />Source: CDM · R&U {sc.firstPassYield == null ? "(835 · 837 pending)" : "· 835 · 837"}
        </div>
      </div>

      {/* Hero */}
      <div className="grid grid-cols-1 sm:grid-cols-[280px_1fr] gap-5 mb-5">
        <div className="rounded-2xl p-6 text-white text-center" style={{ background: NAVY }}>
          <div className="text-[12px] font-semibold uppercase tracking-wider text-[#A9BDCB]">Overall RC Health</div>
          <div className="text-[64px] font-extrabold leading-none my-2">{sc.overall ?? "—"}</div>
          <div className="text-[20px] font-bold" style={{ color: overallHex === "#A23B2A" ? "#e88b7d" : "#C9881F" }}>{sc.overallGrade}{sc.overall != null && ` · ${sc.overallBand === "strong" ? "Strong" : sc.overallBand === "ok" ? "Adequate" : sc.overallBand === "risk" ? "At Risk" : "Critical"}`}</div>
          <div className="text-[12px] text-[#C4D2DC] mt-1.5">Weighted across the scored functional areas</div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <HeroStat k="Net opportunity (annual)" v={money(sc.opportunity.netTotal)} n="recurring + one-time, net realizable" color="#2F7A4D" />
          <HeroStat k="Cost of inaction" v={money(sc.opportunity.costOfInaction.dailyLeak * 365)} n="recurring leak + compliance exposure" color="#A23B2A" />
          <HeroStat k="Findings identified" v={sc.opportunity.byCategory.reduce((s, c) => s + c.count, 0).toLocaleString()} n="across the engine's rule set" />
          <HeroStat k="First-pass yield" v={sc.firstPassYield == null ? "—" : `${sc.firstPassYield}%`} n={sc.firstPassYield == null ? "awaiting 835 remittance" : "clean-claim rate (835)"} />
          <HeroStat k="Denial rate" v={sc.denialRate == null ? "—" : `${sc.denialRate}%`} n={sc.denialRate == null ? "awaiting 835 remittance" : "by denied $ (835)"} />
          <HeroStat k="Net collection yield" v={sc.netCollectionYield == null ? "—" : `${sc.netCollectionYield}%`} n={sc.netCollectionYield == null ? "awaiting 835 remittance" : "paid ÷ allowed (835)"} />
        </div>
      </div>

      <div className="text-[16px] font-bold mb-3" style={{ color: NAVY }}>Functional area scores — front-end → middle → back-end</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        {sc.areas.map((a) => {
          const hex = BAND_HEX[a.band];
          return (
            <div key={a.name} className="relative bg-white rounded-xl border border-[#DCE3EA] p-4 pl-5 overflow-hidden">
              <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: hex }} />
              <div className="text-[15px] font-bold" style={{ color: NAVY }}>{a.name}</div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#64748b] mb-2.5">{a.stage}</div>
              {a.score == null ? (
                <div className="text-[12.5px] text-[#94a3b8] py-2">Awaiting 835 / 837 claims &amp; remittance data. Scores for this area unlock when the claims files are ingested.</div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-2.5">
                    <div className="flex-1 h-3.5 bg-[#EEF2F6] rounded-full overflow-hidden"><span className="block h-full rounded-full" style={{ width: `${a.score}%`, background: hex }} /></div>
                    <div className="text-[22px] font-extrabold tabular-nums" style={{ color: NAVY }}>{a.score}</div>
                    <div className="text-[13px] font-bold" style={{ color: hex }}>{a.grade}</div>
                  </div>
                  <div className="text-[12.5px] text-[#1E293B] leading-relaxed">
                    {a.drivers.length ? a.drivers.map((d, i) => (
                      <span key={d.label}>{i > 0 && " · "}<b style={{ color: NAVY }}>{d.label}</b> {d.count}{d.net > 0 ? ` (${money(d.net)})` : ""}</span>
                    )) : <span className="text-[#94a3b8]">No material findings in this area.</span>}
                  </div>
                  <div className="flex justify-between mt-2.5 text-[12px]">
                    <span className="font-bold" style={{ color: "#2F7A4D" }}>{money(a.netOpp)} net opp</span>
                    <span className="text-[#64748b]">{a.source}</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* Methodology */}
      <div className="rounded-xl p-5 mt-5 text-white" style={{ background: NAVY }}>
        <div className="text-[14px] font-semibold mb-2.5">How each score is computed</div>
        <div className="text-[12.5px] text-[#C4D2DC] leading-relaxed">
          Each area is scored 0–100 from the engine's findings — the net-realizable opportunity and finding density attributed to that function — then rolled up into an overall grade weighted by dollar exposure. Every score carries its net opportunity and top drivers, so a grade always points to a specific, quantified fix. The engine quantifies; the consultant decides what's real.
        </div>
        <div className="flex gap-0 mt-3 rounded-md overflow-hidden text-[11px] font-bold text-center text-white">
          <div className="flex-1 py-1.5" style={{ background: "#2F7A4D" }}>90–100 · A · Strong</div>
          <div className="flex-1 py-1.5" style={{ background: "#0E7C86" }}>80–89 · B · Adequate</div>
          <div className="flex-1 py-1.5" style={{ background: "#C9881F" }}>65–79 · C · At Risk</div>
          <div className="flex-1 py-1.5" style={{ background: "#A23B2A" }}>&lt;65 · D/F · Critical</div>
        </div>
      </div>
      <p className="text-[11px] text-[#94a3b8] mt-3 text-center">Live values computed by the {PRODUCT.name} engine from the facility's own files. Areas needing the 835/837 claims and remittance files are marked pending until those are ingested.</p>
    </div>
  );
}

function HeroStat({ k, v, n, color }: { k: string; v: string; n: string; color?: string }) {
  return (
    <div className="bg-white border border-[#DCE3EA] rounded-xl p-4">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-[#64748b]">{k}</div>
      <div className="text-[26px] font-extrabold mt-1" style={{ color: color || NAVY }}>{v}</div>
      <div className="text-[11.5px] text-[#64748b] mt-0.5">{n}</div>
    </div>
  );
}
