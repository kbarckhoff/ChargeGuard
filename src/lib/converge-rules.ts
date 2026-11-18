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
  dx_code?: string | null; mod1?: string | null; mod2?: string | null; mod3?: string | null; mod4?: string | null;
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

// ─── Charge-capture batch 2 (Greg's F-* claims-based flag items) ──────────────
// Config-driven companion / pair / diagnosis checks from Greg's
// Charge_Capture_Flag_Items_with_Tiers.xlsx (the Rapid, claims-only tier — the
// items whose "Data needed" is just the claims extract). Each finding is a review
// prompt with a count + reason, never a gross-dollar headline (Greg's output
// contract). The chart/EHR-dependent items (Full / Remediation tier) are tracked
// in the rule catalog as a backlog, not built here.
//
// CODE SETS BELOW ARE ILLUSTRATIVE and must be validated against the current year's
// code sets and payer rules before a client sees them (Greg's own caveat).
const RADIOPHARM = /^A9[5-6]\d\d$/;            // A9500–A9699 radiopharmaceuticals
const DEVICE_CCODE = /^C\d{4}$/;               // any device C-code
const VACCINE_PRODUCT = /^90[67]\d\d$/;        // 90600–90799 vaccine products
const INHALE_DRUG = new Set(["J7611", "J7613", "J7620", "J7644", "J7645"]); // albuterol / ipratropium
const INHALE_TREATMENT = new Set(["94640", "94644", "94645"]);
const IV_FLUID = new Set(["J7030", "J7040", "J7042", "J7050", "J7060", "J7070", "J7120", "J7121"]);
const ECG = new Set(["93000", "93005", "93010"]);
const URINALYSIS = new Set(["81000", "81001", "81002", "81003"]);
// Representative device-bearing procedures (stent, EP, vascular access, neurostim).
const DEVICE_PROC = new Set(["92928", "92929", "92933", "92934", "37236", "37237", "47538", "43266", "93653", "93654", "93655", "93656", "93657", "36561", "36563", "36565", "36566", "36558", "36569", "36571", "36572", "36573", "63650", "63655", "63685", "64553", "64561", "64581", "61885", "61886", "64590"]);

interface ClaimCtx { codes: Set<string>; revs: Set<string>; dxs: Set<string> }
interface Batch2Check {
  id: string; title: string; sev: ConvergeRuleResult["severity"]; category: string; rec: string;
  // Returns the anchor HCPCS (a code expected to be in the CDM) to attach the
  // finding to, or null when the check doesn't fire for this claim.
  find: (ctx: ClaimCtx) => string | null;
}

const dxHit = (dxs: Set<string>, prefixes: string[]) => [...dxs].some((d) => prefixes.some((p) => d.startsWith(p)));

const BATCH2_CHECKS: Batch2Check[] = [
  { id: "img_nucmed_no_radiopharm", title: "Nuclear medicine study without a radiopharmaceutical", sev: "medium", category: "Charge Capture — Missing Companion",
    rec: "Add the radiopharmaceutical charge (A9500–A9699) for the nuclear medicine study.",
    find: (c) => c.revs.has("034") && ![...c.codes].some((h) => RADIOPHARM.test(h)) ? ([...c.codes].find((h) => h) || null) : null },
  { id: "inf_inhale_no_treatment", title: "Inhaled medication without a breathing treatment", sev: "low", category: "Charge Capture — Missing Companion",
    rec: "Add the nebulizer / inhalation treatment charge (94640, or 94644 + 94645).",
    find: (c) => { const d = [...c.codes].find((h) => INHALE_DRUG.has(h)); return d && ![...c.codes].some((h) => INHALE_TREATMENT.has(h)) ? d : null; } },
  { id: "inf_hydration_plus_fluid", title: "Hydration with a separately charged IV fluid", sev: "low", category: "Charge Capture — Over-charge / Duplicate",
    rec: "No-bill the bulk IV fluid line per your payer packaging rules when hydration administration is already charged.",
    find: (c) => { const hasHyd = c.codes.has("96360") || c.codes.has("96361"); const fluid = [...c.codes].find((h) => IV_FLUID.has(h)); return hasHyd && fluid ? (c.codes.has("96360") ? "96360" : "96361") : null; } },
  { id: "dev_proc_no_ccode", title: "Device procedure without a device charge", sev: "high", category: "Charge Capture — Missing Companion",
    rec: "Add the device/implant charge (C-code) from the implant log for this procedure.",
    find: (c) => { const p = [...c.codes].find((h) => DEVICE_PROC.has(h)); return p && ![...c.codes].some((h) => DEVICE_CCODE.test(h)) ? p : null; } },
  { id: "imm_product_no_admin", title: "Vaccine product without an administration charge", sev: "low", category: "Charge Capture — Missing Companion",
    rec: "Add the vaccine administration charge (90471–90474 / G0008–G0010) for the product given.",
    find: (c) => { const v = [...c.codes].find((h) => VACCINE_PRODUCT.test(h)); return v && ![...c.codes].some((h) => VACCINE_ADMIN.has(h)) ? v : null; } },
  { id: "ed_chestpain_no_ecg", title: "Chest-pain visit without an ECG", sev: "medium", category: "Charge Capture — Missing Ancillary (Dx)",
    rec: "Confirm the ECG in the chart and add the tracing charge (93005/93010); exclude cases where EMS performed it.",
    find: (c) => dxHit(c.dxs, ["R07"]) && ![...c.codes].some((h) => ECG.has(h)) ? ([...c.codes].find((h) => h) || null) : null },
  { id: "ed_resp_no_treatment", title: "Respiratory diagnosis without a breathing treatment", sev: "low", category: "Charge Capture — Missing Ancillary (Dx)",
    rec: "Confirm the treatment in the chart and add the charge (94640 / 94644+94645) when given in the department.",
    find: (c) => dxHit(c.dxs, ["J44", "J45", "R06.2"]) && ![...c.codes].some((h) => INHALE_TREATMENT.has(h)) ? ([...c.codes].find((h) => h) || null) : null },
  { id: "ed_urinary_no_ua", title: "Urinary diagnosis without a urinalysis", sev: "low", category: "Charge Capture — Missing Ancillary (Dx)",
    rec: "Confirm the urinalysis in the chart and add the charge (81001–81003); many EDs bill UA under a lab panel.",
    find: (c) => dxHit(c.dxs, ["N39.0", "R30.0", "R31"]) && ![...c.codes].some((h) => URINALYSIS.has(h)) ? ([...c.codes].find((h) => h) || null) : null },
];

/**
 * Charge-capture batch 2 — Greg's F-* claims-based flag items beyond the batch-1
 * companions. Groups the claims extract by claim, runs each configured check, and
 * aggregates by (check, anchor code) so one finding summarizes many claims. A
 * finding surfaces only when its anchor code exists in the CDM.
 */
export function runChargeCaptureBatch2Rules(cdm: CdmLite[], claims: ClaimRow[]): ConvergeRuleResult[] {
  const idx = cdmIndex(cdm);
  const byClaim = new Map<string, ClaimRow[]>();
  for (const r of claims) { const k = r.claim_id || "__none"; (byClaim.get(k) || byClaim.set(k, []).get(k)!).push(r); }

  type Agg = { count: number; anchor: string; meta: Batch2Check };
  const agg = new Map<string, Agg>();
  for (const [, lines] of byClaim) {
    const ctx: ClaimCtx = {
      codes: new Set(lines.map((l) => norm(l.hcpcs)).filter(Boolean)),
      revs: new Set(lines.map((l) => digits(l.rev_code).slice(0, 3)).filter(Boolean)),
      dxs: new Set(lines.map((l) => String(l.dx_code ?? "").trim().toUpperCase()).filter(Boolean)),
    };
    for (const chk of BATCH2_CHECKS) {
      const anchor = chk.find(ctx);
      if (!anchor) continue;
      const key = `${chk.id}|${anchor}`;
      const e = agg.get(key) || { count: 0, anchor, meta: chk }; e.count++; agg.set(key, e);
    }
  }

  const out: ConvergeRuleResult[] = [];
  for (const [, e] of agg) {
    const cdmLine = idx.get(e.anchor);
    if (!cdmLine) continue;
    out.push({
      rule_id: `CC2.${e.meta.id}`, charge_item_id: cdmLine.id,
      title: e.meta.title,
      description: `${e.anchor} appears on ${e.count} claim(s) where this charge-capture check fired. Review prompt — confirm against the chart before acting.`,
      severity: e.meta.sev, category: e.meta.category,
      recommendation: e.meta.rec,
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
