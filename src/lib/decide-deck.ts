// ─── CONVERGE "Decide" exec deck (Phase A finish) ────────────
// The consultant's hand-off deliverable: a self-contained, print-ready HTML deck
// built from the scorecard + opportunity model. No dependencies — the consultant
// opens it, reviews, and prints to PDF (⌘P) or sends the file. Each section is a
// print page (page-break-after). Calm Vanta/Linear register, matches ScorecardView.

import type { Scorecard, Band } from "./scorecard";

const money = (n: number) => {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
};
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const BAND_HEX: Record<Band, string> = { strong: "#15803d", ok: "#0e7490", risk: "#b45309", crit: "#be123c", pending: "#9ca3af" };
const BAND_SOFT: Record<Band, string> = { strong: "#f0fdf4", ok: "#ecfeff", risk: "#fffbeb", crit: "#fff1f2", pending: "#f8fafc" };
const BAND_LABEL: Record<Band, string> = { strong: "Strong", ok: "Adequate", risk: "At risk", crit: "Critical", pending: "Pending data" };

export interface DeckMeta {
  product: string;
  facility: string;
  period: string;
  generatedAt: string;             // ISO
  referenceVintage?: Record<string, any> | null;
  gateSummary?: { missingFacts?: string[]; caveated?: number; blocked?: number } | null;
}

export function buildDecideDeckHtml(sc: Scorecard, meta: DeckMeta): string {
  const opp = sc.opportunity;
  const overallHex = BAND_HEX[sc.overallBand];
  const gen = new Date(meta.generatedAt);
  const genStr = gen.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // Waterfall is relative (no currentNetRevenue set) → show the increments.
  const phase1 = opp.phase1Net, phase2 = opp.phase2Net;
  const maxBar = Math.max(opp.netRecurring, opp.netOneTime, phase1, phase2, 1);

  const areaRows = sc.areas.map((a) => {
    const hex = BAND_HEX[a.band];
    const scoreCell = a.score == null
      ? `<span class="pill" style="background:${BAND_SOFT.pending};color:${BAND_HEX.pending}">Pending claims</span>`
      : `<b style="color:#1a1a2e">${a.score}</b> <span class="pill" style="background:${BAND_SOFT[a.band]};color:${hex}">${a.grade}</span>`;
    const drivers = a.score == null
      ? '<span class="mut">Unlocks with 835/837 ingestion</span>'
      : (a.drivers.length ? a.drivers.map((d) => `${esc(d.label)} ${d.count}`).join(" · ") : '<span class="mut">No material findings</span>');
    return `<tr>
      <td><div class="area-name">${esc(a.name)}</div><div class="area-stage">${esc(a.stage)}</div></td>
      <td class="nowrap">${scoreCell}</td>
      <td class="drivers">${drivers}</td>
      <td class="num">${a.score == null ? "—" : money(a.netOpp)}</td>
    </tr>`;
  }).join("");

  const catRows = opp.byCategory.slice(0, 12).filter((c) => c.net > 0).map((c) => `<tr>
      <td>${esc(c.category)}</td>
      <td class="nowrap"><span class="tag tag-${c.cadence}">${c.cadence === "recurring" ? "Recurring" : "One-time"}</span></td>
      <td class="nowrap">${c.phase === "phase_1" ? "Phase 1" : "Phase 2"}</td>
      <td class="num">${c.count.toLocaleString()}</td>
      <td class="num">${money(c.gross)}</td>
      <td class="num"><b>${money(c.net)}</b></td>
    </tr>`).join("");

  const bar = (label: string, val: number, hex: string, sub: string) => `
    <div class="wf-row">
      <div class="wf-label">${label}<span class="wf-sub">${sub}</span></div>
      <div class="wf-track"><span style="width:${Math.max(2, (val / maxBar) * 100)}%;background:${hex}"></span></div>
      <div class="wf-val">${money(val)}</div>
    </div>`;

  const refNote = meta.referenceVintage?.sources
    ? `Reference data pinned ${new Date(meta.referenceVintage.pinned_at).toLocaleDateString()} · ${Object.keys(meta.referenceVintage.sources).length} CMS sources`
    : "Reference data: live CMS set";
  const gateNote = meta.gateSummary?.missingFacts?.length
    ? `<div class="note">Provisional: ${meta.gateSummary.caveated || 0} finding(s) assume defaults pending setup facts (${meta.gateSummary.missingFacts.map(esc).join(", ")}). Confirm to finalize.</div>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(meta.product)} — State of the Revenue Cycle — ${esc(meta.facility)}</title>
<style>
  :root { --ink:#1a1a2e; --mut:#6b7280; --line:#ececf1; --accent:#4f46e5; }
  * { box-sizing:border-box; }
  html,body { margin:0; padding:0; background:#f3f4f6; color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  .toolbar { position:sticky; top:0; background:#fff; border-bottom:1px solid var(--line); padding:10px 20px; display:flex; justify-content:space-between; align-items:center; }
  .toolbar b { font-size:13px; } .toolbar span { font-size:12px; color:var(--mut); }
  .btn { background:var(--accent); color:#fff; border:0; border-radius:7px; padding:8px 14px; font-size:12.5px; font-weight:600; cursor:pointer; }
  .page { width:1040px; min-height:720px; margin:20px auto; background:#fff; border:1px solid var(--line); border-radius:14px; padding:48px 56px; }
  .eyebrow { font-size:11px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); }
  h1 { font-size:34px; font-weight:600; letter-spacing:-.02em; margin:6px 0 2px; }
  h2 { font-size:19px; font-weight:600; margin:0 0 16px; }
  .sub { font-size:13px; color:var(--mut); }
  .mut { color:#9ca3af; } .num { text-align:right; font-variant-numeric:tabular-nums; } .nowrap{white-space:nowrap}
  .pill { display:inline-block; border-radius:999px; padding:1px 8px; font-size:11px; font-weight:600; }
  .cover-hero { display:flex; gap:40px; align-items:center; margin-top:56px; }
  .ring { width:168px; height:168px; position:relative; flex:none; }
  .ring .n { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
  .ring .n b { font-size:52px; font-weight:600; line-height:1; } .ring .n span { font-size:12px; color:#9ca3af; }
  .hero-kpis { display:grid; grid-template-columns:1fr 1fr; gap:14px; flex:1; }
  .kpi { border:1px solid var(--line); border-radius:12px; padding:18px 20px; }
  .kpi .k { font-size:12px; color:#9ca3af; font-weight:500; } .kpi .v { font-size:28px; font-weight:600; margin-top:4px; font-variant-numeric:tabular-nums; } .kpi .n { font-size:11.5px; color:#9ca3af; margin-top:2px; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:#9ca3af; font-weight:600; padding:0 10px 8px; border-bottom:1px solid var(--line); }
  th.num { text-align:right; }
  td { padding:11px 10px; border-bottom:1px solid #f4f4f7; vertical-align:top; }
  .area-name { font-weight:600; } .area-stage { font-size:11px; color:#9ca3af; margin-top:1px; } .drivers{ font-size:12px; color:#4b5563; }
  .tag { border-radius:6px; padding:1px 7px; font-size:11px; font-weight:600; }
  .tag-recurring { background:#eef2ff; color:#4f46e5; } .tag-one_time { background:#f3f4f6; color:#6b7280; }
  .wf-row { display:flex; align-items:center; gap:16px; margin:14px 0; }
  .wf-label { width:240px; font-size:13px; font-weight:500; } .wf-label .wf-sub { display:block; font-size:11px; color:#9ca3af; font-weight:400; }
  .wf-track { flex:1; height:22px; background:#f3f4f6; border-radius:6px; overflow:hidden; } .wf-track span { display:block; height:100%; border-radius:6px; }
  .wf-val { width:96px; text-align:right; font-weight:600; font-variant-numeric:tabular-nums; }
  .split { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:8px; }
  .card { border:1px solid var(--line); border-radius:12px; padding:20px 22px; }
  .card .big { font-size:30px; font-weight:600; font-variant-numeric:tabular-nums; } .card .lbl{ font-size:12px; color:#9ca3af; font-weight:500; }
  .note { margin-top:18px; font-size:11.5px; color:#b45309; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px 12px; }
  .foot { margin-top:28px; font-size:11px; color:#9ca3af; display:flex; justify-content:space-between; border-top:1px solid var(--line); padding-top:12px; }
  .moves { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  .move-h { font-size:13px; font-weight:700; margin-bottom:4px; } .move-sub{ font-size:11.5px; color:#9ca3af; margin-bottom:12px; }
  .move-amt { font-size:26px; font-weight:600; font-variant-numeric:tabular-nums; }
  ul.moves-list { margin:10px 0 0; padding-left:18px; font-size:12.5px; color:#374151; } ul.moves-list li { margin:5px 0; }
  @media print {
    body { background:#fff; } .toolbar { display:none; }
    .page { margin:0; border:0; border-radius:0; width:auto; min-height:auto; page-break-after:always; padding:36px 40px; }
    @page { size:landscape; margin:14mm; }
  }
</style></head>
<body>
  <div class="toolbar">
    <div><b>${esc(meta.product)} · State of the Revenue Cycle</b> &nbsp; <span>${esc(meta.facility)} · ${esc(meta.period)}</span></div>
    <button class="btn" onclick="window.print()">Download / Print PDF</button>
  </div>

  <!-- Cover + headline -->
  <section class="page">
    <div class="eyebrow">${esc(meta.product)} · Revenue Cycle Health</div>
    <h1>State of the Revenue Cycle</h1>
    <div class="sub">${esc(meta.facility)} &middot; ${esc(meta.period)} &middot; Prepared ${genStr}</div>
    <div class="cover-hero">
      <div class="ring">
        <svg viewBox="0 0 120 120" style="transform:rotate(-90deg)">
          <circle cx="60" cy="60" r="54" fill="none" stroke="#f1f1f5" stroke-width="10"/>
          ${sc.overall != null ? `<circle cx="60" cy="60" r="54" fill="none" stroke="${overallHex}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${2 * Math.PI * 54}" stroke-dashoffset="${2 * Math.PI * 54 * (1 - (sc.overall || 0) / 100)}"/>` : ""}
        </svg>
        <div class="n"><b>${sc.overall ?? "—"}</b><span>of 100</span></div>
      </div>
      <div class="hero-kpis">
        <div class="kpi"><div class="k">Overall grade</div><div class="v" style="color:${overallHex}">${sc.overallGrade} · ${BAND_LABEL[sc.overallBand]}</div><div class="n">weighted by dollar exposure</div></div>
        <div class="kpi"><div class="k">Net opportunity (annual)</div><div class="v" style="color:#15803d">${money(opp.netTotal)}</div><div class="n">net realizable, ${money(opp.confidence.low)}–${money(opp.confidence.high)} band</div></div>
        <div class="kpi"><div class="k">Cost of inaction</div><div class="v" style="color:#be123c">${money(opp.costOfInaction.dailyLeak * 365)}</div><div class="n">recurring leak per year</div></div>
        <div class="kpi"><div class="k">Findings identified</div><div class="v">${opp.byCategory.reduce((s, c) => s + c.count, 0).toLocaleString()}</div><div class="n">across the engine rule set</div></div>
      </div>
    </div>
    ${gateNote}
    <div class="foot"><span>${esc(meta.product)} diagnostic · the engine quantifies, the consultant decides</span><span>${esc(refNote)}</span></div>
  </section>

  <!-- Scorecard -->
  <section class="page">
    <div class="eyebrow">Scorecard</div>
    <h2>Functional-area health · front-end → middle → back-end</h2>
    <table>
      <thead><tr><th>Area</th><th>Score</th><th>Top drivers</th><th class="num">Net opp</th></tr></thead>
      <tbody>${areaRows}</tbody>
    </table>
    <div class="foot"><span>Pending areas unlock when the 835 remittance and 837 claim files are ingested.</span><span>${esc(meta.facility)}</span></div>
  </section>

  <!-- Opportunity -->
  <section class="page">
    <div class="eyebrow">Opportunity</div>
    <h2>Where the money is &amp; how it behaves</h2>
    ${bar("Phase 1 — quick wins", phase1, "#15803d", "coding &amp; data fixes, fast to cash")}
    ${bar("Phase 2 — pricing &amp; workstreams", phase2, "#0e7490", "longer alignment work")}
    ${bar("Recurring (annual)", opp.netRecurring, "#4f46e5", "repeats every period once fixed")}
    ${bar("One-time", opp.netOneTime, "#9ca3af", "captured once")}
    <div class="split" style="margin-top:22px">
      <div class="card"><div class="lbl">Gross identified</div><div class="big">${money(opp.grossTotal)}</div></div>
      <div class="card"><div class="lbl">Net realizable (what we underwrite)</div><div class="big" style="color:#15803d">${money(opp.netTotal)}</div></div>
    </div>
    <div class="foot"><span>Net ≤ gross by design — conservative realization rates by fix type; recurring and one-time never blended.</span><span></span></div>
  </section>

  <!-- Category detail -->
  <section class="page">
    <div class="eyebrow">Opportunity detail</div>
    <h2>Top categories by net opportunity</h2>
    <table>
      <thead><tr><th>Category</th><th>Cadence</th><th>Phase</th><th class="num">Findings</th><th class="num">Gross</th><th class="num">Net</th></tr></thead>
      <tbody>${catRows || '<tr><td colspan="6" class="mut">No priced findings.</td></tr>'}</tbody>
    </table>
    <div class="foot"><span>Top 12 priced categories shown.</span><span>${esc(meta.product)}</span></div>
  </section>

  <!-- Decide -->
  <section class="page">
    <div class="eyebrow">Decide</div>
    <h2>Recommended next moves</h2>
    <div class="moves">
      <div class="card">
        <div class="move-h" style="color:#15803d">Phase 1 — prove the number</div>
        <div class="move-sub">Quick wins that need no client data and land fast</div>
        <div class="move-amt" style="color:#15803d">${money(phase1)}</div>
        <ul class="moves-list">
          <li>Work the coding &amp; data-quality findings in the Act workbench</li>
          <li>Assign owners, set due dates, track to implemented</li>
          <li>Re-run to show the grade move</li>
        </ul>
      </div>
      <div class="card">
        <div class="move-h" style="color:#0e7490">Phase 2 — pricing &amp; workstreams</div>
        <div class="move-sub">Longer alignment work, larger dollars</div>
        <div class="move-amt" style="color:#0e7490">${money(phase2)}</div>
        <ul class="moves-list">
          <li>Align flagged prices to benchmark &amp; fee schedules</li>
          <li>Resolve pricing-consistency variance across lines</li>
          <li>Stand up the claims files (835/837) to light up the back-end areas</li>
        </ul>
      </div>
    </div>
    <div class="note" style="color:#374151;background:#fafafb;border-color:#ececf1;margin-top:22px">
      This diagnostic is produced by the ${esc(meta.product)} engine from the facility's own files. Dollar figures are net-realizable estimates for prioritization; each one traces to specific CDM lines in the detailed findings. The engine quantifies; the consultant decides what's real before action.
    </div>
    <div class="foot"><span>Prepared ${genStr}</span><span>${esc(refNote)}</span></div>
  </section>
</body></html>`;
}
