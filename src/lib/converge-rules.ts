// ─── Converge rules batch 1 (use the new intake fields) ──────
// Rules that run on the de-identified claims extract + item master Greg asked for.
// This is the first slice of his rule register, the part that needs no extra CMS
// reference tables: charge-capture companion edits (F-INF / F-LAB family), denial
// analysis by CARC (#37 / BH-3), pricing-vs-paid (CDM vs 835 allowed), and the
// item-master reconciliation (device / C-code / rev-code setup). NCCI, MUE and
// device-edit rules come in a later batch when those reference tables are loaded.
//
// Findings attach to the CDM line that matches the triggering HCPCS, so they show
// up in the normal findings workbench. Pure functions; no I/O.

import { normalizeHcpcs } from "./cms-reference";

export interface ConvergeRuleResult {
  rule_id: string; charge_item_id: string; title: string; description: string;
  severity: "critical" | "high" | "medium" | "low" | "info"; category: string;
  financial_impact?: number; recommendation: string;
}

// ── Claims extract row shape (subset this module reads) ──
export interface ClaimRow {
  claim_id: string | null; hcpcs: string | null; rev_code: string | null; units: number | null;
  billed_amount: number | null; allowed_amount: number | null; paid_amount: number | null;
  denial_code: string | null; payer: string | null;
}
interface CdmLite { id: string; hcpcs_cpt_code: string | null; gross_charge: number | null; charge_description?: string | null; procedure_number?: string | null }

const norm = (s: any) => normalizeHcpcs(String(s ?? ""));
const digits = (s: any) => String(s ?? "").replace(/\D/g, "");
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

// Build a HCPCS → CDM charge-item-id index (first line wins).
function cdmIndex(cdm: CdmLite[]): Map<string, CdmLite> {
  const m = new Map<string, CdmLite>();
  for (const it of cdm) { const k = norm(it.hcpcs_cpt_code); if (k && !m.has(k)) m.set(k, it); }
  return m;
}

// ── Code sets (illustrative; validate against current code sets yearly) ──
const INFUSION_ADMIN = new Set(["96360", "96361", "96365", "96366", "96367", "96368", "96369", "96370", "96371", "96372", "96373", "96374", "96375", "96376", "96377", "96379", "96401", "96402", "96409", "96411", "96413", "96415", "96416", "96417"]);
const VACCINE_ADMIN = new Set(["90471", "90472", "90473", "90474", "G0008", "G0009", "G0010"]);
const INFUSION_INITIAL = new Set(["96360", "96365", "96374", "96409", "96413"]);
const INFUSION_ADDON = new Set(["96361", "96366", "96367", "96375", "96411", "96415", "96417"]);
const COLLECTION = new Set(["36415", "36416"]);

const isDrug = (r: ClaimRow) => {
  const h = norm(r.hcpcs); const rc = digits(r.rev_code);
  return /^J\d/.test(h) || rc === "0636" || rc.startsWith("025");
};
const isAdmin = (h: string) => INFUSION_ADMIN.has(h) || VACCINE_ADMIN.has(h);
const isLabTest = (h: string) => { const n = parseInt(h, 10); return /^\d{5}$/.test(h) && n >= 80000 && n <= 89999; };

/**
 * Charge-capture companion edits, grouped by claim. Catches drug-without-admin,
 * admin-without-drug, add-on-infusion-without-initial, and collection-without-lab
 * (Greg's F-INF-01/02/03 and F-LAB-01). A finding attaches to the CDM line that
 * matches the anchor code; claims whose code isn't in the CDM are left to the
 * billed-not-in-CDM check.
 */
export function runChargeCapturePairRules(cdm: CdmLite[], claims: ClaimRow[]): ConvergeRuleResult[] {
  const idx = cdmIndex(cdm);
  const byClaim = new Map<string, ClaimRow[]>();
  for (const r of claims) { const k = r.claim_id || "__none"; (byClaim.get(k) || byClaim.set(k, []).get(k)!).push(r); }

  // aggregate issues by (anchorHcpcs, type) so one finding summarizes many claims
  type Agg = { count: number; amount: number; anchor: string };
  const agg = new Map<string, Agg>();
  const bump = (key: string, anchor: string, amt: number) => {
    const e = agg.get(key) || { count: 0, amount: 0, anchor }; e.count++; e.amount += amt; agg.set(key, e);
  };

  for (const [, lines] of byClaim) {
    const codes = lines.map((l) => norm(l.hcpcs)).filter(Boolean);
    const codeSet = new Set(codes);
    const drugLines = lines.filter(isDrug);
    const hasAdmin = codes.some(isAdmin);
    const hasDrug = drugLines.length > 0;
    const drugAmt = drugLines.reduce((s, l) => s + (l.billed_amount || 0), 0);

    if (hasDrug && !hasAdmin) { const a = norm(drugLines[0].hcpcs); bump(`drug_no_admin|${a}`, a, drugAmt); }
    if (hasAdmin && !hasDrug) { const a = codes.find(isAdmin)!; bump(`admin_no_drug|${a}`, a, 0); }
    // add-on infusion without any qualifying initial
    const addOns = codes.filter((h) => INFUSION_ADDON.has(h));
    const hasInitial = codes.some((h) => INFUSION_INITIAL.has(h));
    if (addOns.length && !hasInitial) bump(`addon_no_initial|${addOns[0]}`, addOns[0], 0);
    // collection without any lab test
    const coll = codes.find((h) => COLLECTION.has(h));
    if (coll && !codes.some(isLabTest)) bump(`coll_no_lab|${coll}`, coll, 0);
  }

  const TITLES: Record<string, { t: string; sev: ConvergeRuleResult["severity"]; rec: string }> = {
    drug_no_admin: { t: "Drug billed with no administration service", sev: "high", rec: "Add the matching administration code from the MAR (infusion/injection/vaccine admin). Exclude self-administered and oral drugs." },
    admin_no_drug: { t: "Administration billed with no drug", sev: "high", rec: "Add the drug charge from the MAR for the administered service." },
    addon_no_initial: { t: "Add-on infusion without its initial service", sev: "high", rec: "Add the qualifying initial service or re-sequence per the infusion hierarchy." },
    coll_no_lab: { t: "Specimen collection with no lab test", sev: "medium", rec: "Add the lab test charge(s), unless the reference/outreach lab bills on a separate account." },
  };
  const out: ConvergeRuleResult[] = [];
  for (const [key, e] of agg) {
    const type = key.split("|")[0];
    const cdmLine = idx.get(e.anchor);
    if (!cdmLine) continue; // anchor code not in CDM → handled elsewhere
    const m = TITLES[type];
    out.push({
      rule_id: `CC.${type}`, charge_item_id: cdmLine.id,
      title: m.t,
      description: `${e.anchor} appears on ${e.count} claim(s) ${type === "drug_no_admin" ? "with a drug but no administration service" : type === "admin_no_drug" ? "with an administration service but no drug" : type === "addon_no_initial" ? "with an add-on infusion but no qualifying initial service" : "with a specimen collection but no lab test"}.${e.amount ? ` ~${money(e.amount)} in affected drug charges.` : ""}`,
      severity: m.sev, category: "Charge Capture — Missing Companion",
      financial_impact: e.amount || undefined,
      recommendation: m.rec,
    });
  }
  return out;
}

/**
 * Denial analysis: recurring denial reasons by code + CARC + payer, from the
 * claims extract (Greg #37 / BH-3). Summed denied dollars, attached to the CDM
 * line for the code.
 */
export function runDenialRules(cdm: CdmLite[], claims: ClaimRow[]): ConvergeRuleResult[] {
  const idx = cdmIndex(cdm);
  type Agg = { count: number; denied: number; payers: Set<string> };
  const agg = new Map<string, Agg>(); // key: hcpcs|carc
  for (const r of claims) {
    if (!r.denial_code) continue;
    const h = norm(r.hcpcs); if (!h) continue;
    const key = `${h}|${r.denial_code}`;
    const e = agg.get(key) || { count: 0, denied: 0, payers: new Set() };
    e.count++; e.denied += Math.max(0, (r.billed_amount || 0) - (r.paid_amount || 0));
    if (r.payer) e.payers.add(r.payer);
    agg.set(key, e);
  }
  const out: ConvergeRuleResult[] = [];
  for (const [key, e] of agg) {
    const [h, carc] = key.split("|");
    const cdmLine = idx.get(h);
    if (!cdmLine) continue;
    out.push({
      rule_id: `DEN.${carc}`, charge_item_id: cdmLine.id,
      title: `Recurring denial — ${h} (CARC ${carc})`,
      description: `${h} was denied/adjusted on ${e.count} claim(s) for reason ${carc}${e.payers.size ? ` across ${e.payers.size} payer(s)` : ""}, ${money(e.denied)} in denied charges.`,
      severity: e.denied >= 10000 ? "high" : e.denied >= 1000 ? "medium" : "low",
      category: "Denial Analysis (Claims)",
      financial_impact: e.denied || undefined,
      recommendation: `Work the root cause behind CARC ${carc} for ${h} and prevent recurrence; rework the affected claims.`,
    });
  }
  out.sort((a, b) => (b.financial_impact || 0) - (a.financial_impact || 0));
  return out;
}

/**
 * Pricing vs paid: CDM gross charge compared to the payer-allowed amount from the
 * claims extract (Greg "pricing vs paid" join). Flags CDM lines priced BELOW the
 * average allowed (leaving contractual dollars on the table).
 */
export function runPricingVsPaidRules(cdm: CdmLite[], claims: ClaimRow[]): ConvergeRuleResult[] {
  // average allowed per code (only paid, non-denied lines with a positive allowed)
  const allowed = new Map<string, { sum: number; n: number }>();
  for (const r of claims) {
    if (r.denial_code) continue;
    const a = r.allowed_amount || 0; if (a <= 0) continue;
    const h = norm(r.hcpcs); if (!h) continue;
    const e = allowed.get(h) || { sum: 0, n: 0 }; e.sum += a; e.n++; allowed.set(h, e);
  }
  const out: ConvergeRuleResult[] = [];
  for (const it of cdm) {
    const h = norm(it.hcpcs_cpt_code); if (!h) continue;
    const a = allowed.get(h); if (!a) continue;
    const avgAllowed = a.sum / a.n;
    const price = Number(it.gross_charge) || 0;
    if (price > 0 && avgAllowed > price * 1.05) {
      out.push({
        rule_id: "PVP.low", charge_item_id: it.id,
        title: `CDM price below payer-allowed — ${h}`,
        description: `"${it.charge_description || h}" is priced ${money(price)} but the average payer-allowed amount is ${money(avgAllowed)} across ${a.n} paid claim(s). Charging below allowed caps reimbursement at the charge.`,
        severity: avgAllowed > price * 1.5 ? "high" : "medium",
        category: "Pricing vs Paid (Claims)",
        financial_impact: (avgAllowed - price) * a.n,
        recommendation: `Reprice ${h} to at least the allowed amount so contractual reimbursement isn't capped by the charge.`,
      });
    }
  }
  out.sort((x, y) => (y.financial_impact || 0) - (x.financial_impact || 0));
  return out;
}
