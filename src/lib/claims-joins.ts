// ─── CONVERGE cross-file joins (Phase B) ─────────────────────
// The "actual Converge": join the four files (CDM × R&U × 837 × 835) so a denied
// dollar is traced back to the claim and then to the CDM/coding defect that
// caused it. Also computes the 835-derived headline metrics the scorecard needs
// (first-pass yield, denial rate, net collection yield) and the per-area denial
// buckets that score the back-end functional areas.
//
// Pure functions; no I/O. The scan route supplies the already-loaded rows.

import type { RemitClaim, RemitLine, RemitAdjustment } from "./remit-parser";
import { normalizeHcpcs } from "./cms-reference";

// Scorecard area keys the denial buckets map to (must match AREAS names in scorecard.ts).
export type AreaKey =
  | "Patient Access"
  | "HIM / Coding"
  | "Case Management / UR"
  | "Patient Financial Services"
  | "Underpayment & Yield";

interface Carc {
  area: AreaKey;
  denial: boolean;    // true = a denial/rework; false = an expected contractual adjustment
  root: string;       // plain-language root cause for the trace
}

// CARC catalog — the common Claim Adjustment Reason Codes mapped to the
// functional area that owns the fix and whether the code represents a denial
// (actionable) vs an expected contractual write-off. Not exhaustive; unknown
// CARCs on a zero-paid line are treated as a generic back-end denial.
const CARC: Record<string, Carc> = {
  // ── Patient Access (front-end: registration, eligibility, auth) ──
  "16": { area: "Patient Access", denial: true, root: "Missing/incomplete information (registration or claim data)" },
  "26": { area: "Patient Access", denial: true, root: "Expenses incurred prior to coverage" },
  "27": { area: "Patient Access", denial: true, root: "Expenses incurred after coverage terminated" },
  "31": { area: "Patient Access", denial: true, root: "Patient cannot be identified as our insured (eligibility)" },
  "140": { area: "Patient Access", denial: true, root: "Patient/insured health ID number and name mismatch" },
  "197": { area: "Patient Access", denial: true, root: "Precertification/authorization absent" },
  "198": { area: "Patient Access", denial: true, root: "Precertification/authorization exceeded" },
  "200": { area: "Patient Access", denial: true, root: "Expenses incurred during a non-covered period" },
  "288": { area: "Patient Access", denial: true, root: "Referral absent" },
  // ── Case Management / UR (medical necessity, level of care) ──
  "50": { area: "Case Management / UR", denial: true, root: "Not deemed a medical necessity by the payer" },
  "55": { area: "Case Management / UR", denial: true, root: "Procedure/treatment is experimental/investigational" },
  "56": { area: "Case Management / UR", denial: true, root: "Procedure/treatment not proven effective" },
  "40": { area: "Case Management / UR", denial: true, root: "Charges do not meet emergency/urgent care criteria" },
  "167": { area: "Case Management / UR", denial: true, root: "Diagnosis not covered" },
  // ── HIM / Coding (code, modifier, dx consistency, NCCI) ──
  "4": { area: "HIM / Coding", denial: true, root: "Procedure code inconsistent with the modifier / required modifier missing" },
  "8": { area: "HIM / Coding", denial: true, root: "Procedure inconsistent with the provider type/specialty" },
  "9": { area: "HIM / Coding", denial: true, root: "Diagnosis inconsistent with the patient's age" },
  "10": { area: "HIM / Coding", denial: true, root: "Diagnosis inconsistent with the patient's sex" },
  "11": { area: "HIM / Coding", denial: true, root: "Diagnosis inconsistent with the procedure" },
  "181": { area: "HIM / Coding", denial: true, root: "Procedure code was invalid on the date of service" },
  "182": { area: "HIM / Coding", denial: true, root: "Procedure modifier was invalid on the date of service" },
  "236": { area: "HIM / Coding", denial: true, root: "Procedure/modifier combination not compatible (NCCI)" },
  // ── Patient Financial Services (back-end: billing, timely filing, dup) ──
  "18": { area: "Patient Financial Services", denial: true, root: "Duplicate claim/service" },
  "29": { area: "Patient Financial Services", denial: true, root: "Timely filing limit expired" },
  "97": { area: "Patient Financial Services", denial: false, root: "Payment included in another service (bundled)" },
  "109": { area: "Patient Financial Services", denial: true, root: "Claim not covered by this payer/contractor" },
  // ── Underpayment & Yield (contractual, not denials — expected write-offs) ──
  "45": { area: "Underpayment & Yield", denial: false, root: "Charge exceeds fee schedule/contracted amount (contractual)" },
  "59": { area: "Underpayment & Yield", denial: false, root: "Multiple-procedure payment reduction (contractual)" },
  "94": { area: "Underpayment & Yield", denial: false, root: "Processed in excess of charges" },
  "253": { area: "Underpayment & Yield", denial: false, root: "Sequestration — federal payment reduction" },
};

const carcInfo = (code: string): Carc =>
  CARC[code] || { area: "Patient Financial Services", denial: true, root: `Payer adjustment reason ${code}` };

const isContractual = (a: RemitAdjustment) => a.group === "CO" && !carcInfo(a.carc).denial;
const hasDenial = (adjs: RemitAdjustment[]) => adjs.some((a) => carcInfo(a.carc).denial);

export interface ClaimsMetrics {
  firstPassYield: number | null;   // % clean claims
  denialRate: number | null;       // % of charges denied/reworked
  netCollectionYield: number | null; // paid ÷ allowed, %
  totalClaims: number;
  deniedClaims: number;
  totalCharge: number;
  totalPaid: number;
}

export interface AreaDenial { count: number; denied: number }

// A denial traced to a CDM line.
export interface TraceFinding {
  charge_item_id: string;
  hcpcs: string;
  area: AreaKey;
  carc: string;
  root: string;
  deniedClaims: number;
  deniedAmount: number;
  cdmCategoriesOnLine: string[]; // existing engine findings on this CDM line, if any
}

export interface JoinResult {
  metrics: ClaimsMetrics;
  areaDenials: Record<string, AreaDenial>;
  traces: TraceFinding[];
}

interface CdmItemLite { id: string; hcpcs: string | null }

/**
 * Join 835 remittance against the CDM to produce metrics, per-area denial
 * buckets, and the denial → CDM root-cause traces.
 * @param findingsByHcpcs  optional: normalized hcpcs → engine finding categories
 *                         already flagged on that line, to enrich each trace.
 */
export function buildClaimsJoins(
  remitClaims: RemitClaim[],
  remitLines: RemitLine[],
  cdmItems: CdmItemLite[],
  findingsByHcpcs?: Map<string, string[]>,
): JoinResult {
  // CDM lookup by normalized HCPCS → the charge item id (first wins).
  const cdmByHcpcs = new Map<string, string>();
  for (const it of cdmItems) {
    const k = normalizeHcpcs(it.hcpcs);
    if (k && !cdmByHcpcs.has(k)) cdmByHcpcs.set(k, it.id);
  }

  // ── Metrics (claim level) ──
  let totalCharge = 0, totalPaid = 0, allowed = 0;
  let totalClaims = 0, cleanClaims = 0, deniedClaims = 0, deniedCharge = 0;
  for (const c of remitClaims) {
    totalClaims++;
    const charge = c.total_charge || 0, paid = c.total_paid || 0, pr = c.patient_resp || 0;
    totalCharge += charge; totalPaid += paid;
    const contractual = (c.adjustments || []).filter(isContractual).reduce((s, a) => s + (a.amount || 0), 0);
    allowed += Math.max(0, charge - contractual);
    const denied = c.status === "4" || hasDenial(c.adjustments || []);
    if (denied) { deniedClaims++; deniedCharge += charge; }
    else if ((c.status === "1" || c.status === "19") && paid > 0) cleanClaims++;
    void pr;
  }

  const metrics: ClaimsMetrics = {
    firstPassYield: totalClaims ? Math.round((cleanClaims / totalClaims) * 100) : null,
    denialRate: totalCharge ? Math.round((deniedCharge / totalCharge) * 1000) / 10 : null,
    netCollectionYield: allowed ? Math.round((totalPaid / allowed) * 1000) / 10 : null,
    totalClaims, deniedClaims, totalCharge, totalPaid,
  };

  // ── Area denial buckets + per-(hcpcs,area) trace aggregation (line level) ──
  const areaDenials: Record<string, AreaDenial> = {};
  const bumpArea = (area: AreaKey, amt: number) => {
    const a = areaDenials[area] || { count: 0, denied: 0 };
    a.count++; a.denied += amt; areaDenials[area] = a;
  };

  // key: hcpcs|area → aggregate
  const traceAgg = new Map<string, { hcpcs: string; area: AreaKey; carc: string; root: string; claims: number; amount: number }>();

  for (const ln of remitLines) {
    const adjs = ln.adjustments || [];
    const denialAdjs = adjs.filter((a) => carcInfo(a.carc).denial);
    if (denialAdjs.length === 0) continue; // paid/contractual-only line
    // Dominant denial reason on this line = largest-amount denial CARC.
    const top = [...denialAdjs].sort((a, b) => (b.amount || 0) - (a.amount || 0))[0];
    const info = carcInfo(top.carc);
    const deniedAmt = denialAdjs.reduce((s, a) => s + (a.amount || 0), 0) || (ln.line_charge || 0) - (ln.line_paid || 0);
    bumpArea(info.area, deniedAmt);

    const hk = normalizeHcpcs(ln.hcpcs);
    if (!hk) continue;
    const key = `${hk}|${info.area}`;
    const e = traceAgg.get(key) || { hcpcs: hk, area: info.area, carc: top.carc, root: info.root, claims: 0, amount: 0 };
    e.claims++; e.amount += deniedAmt;
    traceAgg.set(key, e);
  }

  // ── Build traces for the lines that map to a CDM code ──
  const traces: TraceFinding[] = [];
  for (const e of traceAgg.values()) {
    const itemId = cdmByHcpcs.get(e.hcpcs);
    if (!itemId) continue; // billed-not-in-CDM is handled by the existing claims rule
    traces.push({
      charge_item_id: itemId,
      hcpcs: e.hcpcs,
      area: e.area,
      carc: e.carc,
      root: e.root,
      deniedClaims: e.claims,
      deniedAmount: Math.round(e.amount),
      cdmCategoriesOnLine: findingsByHcpcs?.get(e.hcpcs) || [],
    });
  }
  traces.sort((a, b) => b.deniedAmount - a.deniedAmount);

  return { metrics, areaDenials, traces };
}

// Convert traces into the engine's RuleResult shape so they flow through the
// normal findings insert (shown in Explore + Act). Category = denial root cause.
export function tracesToFindings(traces: TraceFinding[]): Array<{
  rule_id: string; charge_item_id: string; title: string; description: string;
  severity: string; category: string; financial_impact: number | null; recommendation: string;
}> {
  return traces.map((t) => {
    const linked = t.cdmCategoriesOnLine.length
      ? ` This line is already flagged by the engine for: ${t.cdmCategoriesOnLine.join(", ")} — the denial confirms the defect.`
      : "";
    return {
      rule_id: "DEN",
      charge_item_id: t.charge_item_id,
      title: `${t.hcpcs} denied — ${t.area}`,
      description: `${t.hcpcs} was denied on ${t.deniedClaims} claim(s) (${t.carc}: ${t.root}), ${t.deniedAmount ? `$${t.deniedAmount.toLocaleString()} ` : ""}in charges. Owning area: ${t.area}.${linked}`,
      severity: t.deniedAmount >= 10000 ? "high" : t.deniedAmount >= 1000 ? "medium" : "low",
      category: "Denial → CDM Root Cause (Claims)",
      financial_impact: t.deniedAmount || null,
      recommendation: `Resolve the root cause at the CDM/coding level: ${t.root}. Rework the affected claims and prevent recurrence.`,
    };
  });
}
