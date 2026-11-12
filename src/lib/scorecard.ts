// ─── CONVERGE RC Health Scorecard (Phase A) ──────────────────
// Rolls the engine's findings up into the "State of the Revenue Cycle" scorecard
// from Greg's template: an overall 0–100 health grade plus eight functional-area
// scores, each with its net opportunity, top drivers, and source. CDM-side areas
// score from the findings we have today; the areas that need the 835/837 claims
// and remittance files are marked "awaiting claims" until that layer lands
// (mirrors the template's own data-scope note).

import { buildOpportunityModel, type OppFinding, type OpportunityModel } from "./opportunity";

export type Grade = "A" | "B" | "C" | "D" | "F" | "—";
export type Band = "strong" | "ok" | "risk" | "crit" | "pending";

export interface AreaScore {
  name: string;
  stage: string;
  score: number | null;        // 0–100, null when awaiting claims data
  grade: Grade;
  band: Band;
  netOpp: number;              // net-realizable opportunity attributed to this area
  findings: number;
  drivers: { label: string; net: number; count: number }[]; // top categories
  source: string;
  requiresClaims: boolean;
}

export interface Scorecard {
  overall: number | null;
  overallGrade: Grade;
  overallBand: Band;
  areas: AreaScore[];
  opportunity: OpportunityModel;
  // 835-derived headline metrics (null until the remittance file is ingested).
  firstPassYield: number | null;
  denialRate: number | null;
  netCollectionYield: number | null;
}

// Each functional area owns a set of finding categories (matched by keyword).
// requiresClaims areas can't be scored from the CDM + R&U alone.
interface AreaDef { name: string; stage: string; source: string; requiresClaims: boolean; match: RegExp }
const AREAS: AreaDef[] = [
  { name: "Patient Access", stage: "Front-end · registration · eligibility · auth", source: "835 denial CARC", requiresClaims: true, match: /^$/ },
  { name: "HIM / Coding", stage: "Middle · code & modifier accuracy · NCCI", source: "engine coding rules + 835 CARC", requiresClaims: false,
    match: /retired|vaccine|modifier|add-on|device|crosswalk|coding|multiplier|billing unit|lab - /i },
  { name: "Revenue Integrity / CDM Structure", stage: "Middle · pricing · rev codes · SI/APC", source: "engine pricing/structure rules", requiresClaims: false,
    match: /markup|pricing consistency|multi rev|revenue code|si=|bilateral|pass-through|not recognized|clinic visit|benchmark|peer pricing/i },
  { name: "Charge Capture / CDM", stage: "Middle · completeness · dormancy · lost charges", source: "CDM × R&U (+837 for leakage)", requiresClaims: false,
    match: /supply - missing|missing code|pricing - missing|duplicate|description|rvu|low volume|zero/i },
  { name: "Pharmacy Revenue Integrity", stage: "Middle · UOM · billing unit · formulary", source: "engine pharmacy rules + ASP", requiresClaims: false,
    match: /pharmacy|self-admin|formulary|\bndc\b|\buom\b/i },
  { name: "Case Management / UR", stage: "Middle · status · medical necessity · LOC auth", source: "engine SI rules + 835 CARC (partial)", requiresClaims: true, match: /^$/ },
  { name: "Patient Financial Services", stage: "Back-end · billing · denials · AR follow-up", source: "835 full · 837↔835 join", requiresClaims: true, match: /^$/ },
  { name: "Underpayment & Yield", stage: "Back-end · allowed vs paid · contract yield", source: "CDM price × 835 allowed", requiresClaims: true, match: /^$/ },
];

const CUSHION = 600_000; // $ scale at which net opportunity costs ~half the dollar penalty
function scoreFromMetrics(net: number, findings: number): number {
  const dollarPenalty = 42 * (net / (net + CUSHION));            // 0..42, asymptotic
  const densityPenalty = 24 * (findings / (findings + 60));       // 0..24
  return Math.max(35, Math.round(100 - dollarPenalty - densityPenalty));
}
export function gradeFor(score: number | null): { grade: Grade; band: Band } {
  if (score == null) return { grade: "—", band: "pending" };
  if (score >= 90) return { grade: "A", band: "strong" };
  if (score >= 80) return { grade: "B", band: "ok" };
  if (score >= 72) return { grade: "C", band: "risk" };
  if (score >= 65) return { grade: "C", band: "risk" };
  if (score >= 55) return { grade: "D", band: "crit" };
  return { grade: "F", band: "crit" };
}

// 835-derived inputs that let the back-end (claims-dependent) areas score.
export interface ClaimsInput {
  firstPassYield: number | null;
  denialRate: number | null;
  netCollectionYield: number | null;
  // per-area denial buckets, keyed by the AREAS name (count + denied $).
  areaDenials?: Record<string, { count: number; denied: number }>;
}

// Score a back-end area from denial dollars + a headline-metric penalty (0–100).
function scoreClaimsArea(denied: number, metricPenalty: number): number {
  const dollarPenalty = 42 * (denied / (denied + CUSHION));
  return Math.max(35, Math.round(100 - dollarPenalty - metricPenalty));
}

export function buildScorecard(findings: OppFinding[], opts: { hasClaims?: boolean; claims?: ClaimsInput } = {}): Scorecard {
  const opp = buildOpportunityModel(findings);
  const claims = opts.claims;
  const hasClaims = opts.hasClaims || !!claims;

  // Metric penalties (worse metric → bigger penalty), used by the back-end areas.
  const fpyPenalty = claims?.firstPassYield != null ? Math.max(0, (95 - claims.firstPassYield)) * 0.8 : 0; // <95% clean hurts
  const denPenalty = claims?.denialRate != null ? Math.min(30, claims.denialRate * 2.5) : 0;                // 5% denial ≈ 12.5
  const ncyPenalty = claims?.netCollectionYield != null ? Math.max(0, (97 - claims.netCollectionYield)) * 1.2 : 0;

  const areas: AreaScore[] = AREAS.map((def) => {
    if (def.requiresClaims) {
      if (!hasClaims) {
        return { name: def.name, stage: def.stage, score: null, grade: "—", band: "pending", netOpp: 0, findings: 0, drivers: [], source: def.source, requiresClaims: true };
      }
      // Score from the 835 join: this area's denied dollars + the relevant metric.
      const bucket = claims?.areaDenials?.[def.name] || { count: 0, denied: 0 };
      const metricPenalty =
        def.name === "Patient Financial Services" ? denPenalty + fpyPenalty * 0.5 :
        def.name === "Underpayment & Yield" ? ncyPenalty :
        def.name === "Patient Access" ? fpyPenalty * 0.4 :
        def.name === "Case Management / UR" ? denPenalty * 0.4 : 0;
      const score = scoreClaimsArea(bucket.denied, metricPenalty);
      const { grade, band } = gradeFor(score);
      const drivers: { label: string; net: number; count: number }[] = [];
      if (bucket.count) drivers.push({ label: "Denials traced", net: bucket.denied, count: bucket.count });
      if (def.name === "Patient Financial Services" && claims?.firstPassYield != null) drivers.push({ label: `First-pass ${claims.firstPassYield}%`, net: 0, count: 0 });
      if (def.name === "Underpayment & Yield" && claims?.netCollectionYield != null) drivers.push({ label: `Net collection ${claims.netCollectionYield}%`, net: 0, count: 0 });
      return { name: def.name, stage: def.stage, score, grade, band, netOpp: bucket.denied, findings: bucket.count, drivers, source: def.source, requiresClaims: true };
    }
    // CDM-side areas: attribute opportunity categories to this area.
    const cats = opp.byCategory.filter((c) => def.match.test(c.category));
    const netOpp = cats.reduce((s, c) => s + c.net, 0);
    const findingsN = cats.reduce((s, c) => s + c.count, 0);
    const score = scoreFromMetrics(netOpp, findingsN);
    const { grade, band } = gradeFor(score);
    const drivers = cats.slice(0, 3).map((c) => ({ label: c.category, net: c.net, count: c.count }));
    return { name: def.name, stage: def.stage, score, grade, band, netOpp, findings: findingsN, drivers, source: def.source, requiresClaims: def.requiresClaims };
  });

  // Overall = weighted average of SCORED areas, weighted by (netOpp + base) so the
  // biggest-dollar areas move the grade most. Pending areas don't count yet.
  const scored = areas.filter((a) => a.score != null);
  const totW = scored.reduce((s, a) => s + a.netOpp + 50_000, 0) || 1;
  const overall = scored.length ? Math.round(scored.reduce((s, a) => s + (a.score as number) * (a.netOpp + 50_000), 0) / totW) : null;
  const og = gradeFor(overall);

  return {
    overall, overallGrade: og.grade, overallBand: og.band,
    areas, opportunity: opp,
    firstPassYield: claims?.firstPassYield ?? null,
    denialRate: claims?.denialRate ?? null,
    netCollectionYield: claims?.netCollectionYield ?? null,
  };
}
