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
// Revenue-code family (first 3 of the 4-digit form): "360" and "0360" both → "036".
const rev3 = (s: any) => { const d = digits(s); return d ? d.padStart(4, "0").slice(0, 3) : ""; };
// Diagnosis codes compared without the dot, so "R07.9" and "R079" match alike.
const dxNorm = (s: any) => String(s ?? "").trim().toUpperCase().replace(/\./g, "");
const inNum = (h: string, a: number, b: number) => /^\d{5}$/.test(h) && +h >= a && +h <= b;

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
// "With contrast" / "without then with" CT and MRI exams (representative; validate yearly).
const CONTRAST_EXAM = new Set(["70460", "70470", "70481", "70482", "70487", "70488", "70491", "70492", "71260", "71270", "72126", "72127", "72129", "72130", "72132", "72133", "72193", "72194", "73201", "73202", "73701", "73702", "74160", "74170", "74177", "74178",
  "70542", "70543", "70552", "70553", "71551", "71552", "72142", "72147", "72149", "72156", "72157", "72158", "72196", "72197", "73219", "73220", "73222", "73223", "73719", "73720", "73722", "73723", "74182", "74183"]);
const isContrastAgent = (h: string) => h === "Q9951" || /^Q99(5[89]|6[0-7])$/.test(h) || /^A95(7[5-9]|8[0-5])$/.test(h);
const BLOOD_PRODUCT = /^P9\d{3}$/;
const TRANSFUSION_ADMIN = new Set(["36430", "36440", "36450", "36455", "36456", "36460"]);
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
  // CC-7 (contrast side): a "with contrast" CT/MRI with no contrast agent line, and the reverse.
  { id: "img_contrast_no_agent", title: "Contrast exam without a contrast agent charge", sev: "medium", category: "Charge Capture — Missing Companion",
    rec: "Add the contrast agent charge (Q9951, Q9958–Q9967, A9575–A9585) for the with-contrast exam. Exclude oral contrast supplied separately and agents supplied at no charge.",
    find: (c) => { const e = [...c.codes].find((h) => CONTRAST_EXAM.has(h)); return e && ![...c.codes].some(isContrastAgent) ? e : null; } },
  { id: "img_agent_no_contrast_exam", title: "Contrast agent without a with-contrast exam", sev: "low", category: "Charge Capture — Missing Companion",
    rec: "Confirm the exam was coded as with-contrast (or with and without), or remove the agent charge if no contrast exam was performed.",
    find: (c) => { const a = [...c.codes].find(isContrastAgent); return a && ![...c.codes].some((h) => CONTRAST_EXAM.has(h)) && (c.revs.has("035") || c.revs.has("061") || c.revs.has("032")) ? a : null; } },
  // CC-3: blood product with no transfusion administration, and the reverse.
  { id: "blood_product_no_admin", title: "Blood product without a transfusion administration charge", sev: "medium", category: "Charge Capture — Missing Companion",
    rec: "Add the transfusion administration charge (36430) for the date the product was transfused. Exclude products issued but returned, wasted or held on OR standby.",
    find: (c) => { const p = [...c.codes].find((h) => BLOOD_PRODUCT.test(h)); return p && ![...c.codes].some((h) => TRANSFUSION_ADMIN.has(h)) ? p : null; } },
  { id: "blood_admin_no_product", title: "Transfusion administration without a blood product", sev: "medium", category: "Charge Capture — Missing Companion",
    rec: "Add the blood product charge (P9xxx / revenue code 038x) for the unit(s) transfused.",
    find: (c) => { const a = [...c.codes].find((h) => TRANSFUSION_ADMIN.has(h)); return a && ![...c.codes].some((h) => BLOOD_PRODUCT.test(h)) && !c.revs.has("038") ? a : null; } },
  // CC-2: OR case with no facility anesthesia (037x) or recovery (071x). Policy-dependent
  // (some facilities build both into the OR level), so both are low-severity review prompts.
  { id: "or_no_anesthesia", title: "OR procedure without a facility anesthesia charge", sev: "low", category: "Charge Capture — Missing Companion",
    rec: "Confirm whether anesthesia is charged separately (revenue code 037x) or built into the OR level. Exclude local-only and minor procedures. Medicare outpatient payment generally packages it, so value by payer class.",
    find: (c) => { const p = c.revs.has("036") ? [...c.codes].find((h) => inNum(h, 10004, 69990)) : undefined; return p && !c.revs.has("037") ? p : null; } },
  { id: "or_no_recovery", title: "OR procedure without a recovery charge", sev: "low", category: "Charge Capture — Missing Companion",
    rec: "Confirm whether recovery is charged separately (revenue code 071x) or built into the OR level. Exclude local-only and minor procedures.",
    find: (c) => { const p = c.revs.has("036") ? [...c.codes].find((h) => inNum(h, 10004, 69990)) : undefined; return p && !c.revs.has("071") ? p : null; } },
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
      revs: new Set(lines.map((l) => rev3(l.rev_code)).filter(Boolean)),
      dxs: new Set(lines.map((l) => dxNorm(l.dx_code)).filter(Boolean)),
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

// ─── Charge-capture batch 3 (Greg CC-10 … CC-13, added November 2026) ────────
// CC-10 procedure follow-on charges (expected-rate), CC-11 administration family
// consistency, CC-12 payer-specific code substitution, CC-13 ED diagnosis-triggered
// companions (expected-rate by diagnosis group).
//
// Output contract (Greg): every flag is a review prompt with a count and a reason,
// never a gross-dollar headline. The rate rules compare the facility's own claims
// with a PROVISIONAL review threshold; Greg's method calls for the facility's own
// history and a peer benchmark, which replace the thresholds once validated
// (validation item 7). Code sets are written from public coding relationships and
// are tracked in docs/CC_Rule_Validation.md until each is confirmed.

interface ClaimGroup { codes: Set<string>; revs: Set<string>; dxs: Set<string>; payer: string; lines: ClaimRow[] }
function groupClaims(claims: ClaimRow[]): ClaimGroup[] {
  const by = new Map<string, ClaimRow[]>();
  for (const r of claims) { if (!r.claim_id) continue; (by.get(r.claim_id) || by.set(r.claim_id, []).get(r.claim_id)!).push(r); }
  return [...by.values()].map((lines) => ({
    lines,
    codes: new Set(lines.map((l) => norm(l.hcpcs)).filter(Boolean)),
    revs: new Set(lines.map((l) => rev3(l.rev_code)).filter(Boolean)),
    dxs: new Set(lines.map((l) => dxNorm(l.dx_code)).filter(Boolean)),
    payer: String(lines.find((l) => l.payer)?.payer ?? ""),
  }));
}
const some = (codes: Set<string>, f: (h: string) => boolean) => { for (const h of codes) if (f(h)) return true; return false; };
const firstOf = (codes: Set<string>, f: (h: string) => boolean) => { for (const h of codes) if (f(h)) return h; return null; };
const isMedicare = (payer: string) => /medicare|\bmcr\b/i.test(payer);
/** Minimum claims in a group before an expected-rate is reported (a rate on 2 claims is noise). */
export const RATE_MIN_CLAIMS = 5;

// Pick the trigger code to attach a rate finding to: the most frequent trigger that exists in the CDM.
function rateAnchor(idx: Map<string, CdmLite>, freq: Map<string, number>): CdmLite | null {
  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  for (const [h] of ranked) { const l = idx.get(h); if (l) return l; }
  return null;
}

// ── CC-10 · Procedure follow-on charges (expected rate; Full Diagnostic) ──
const CYTOLOGY = (h: string) => inNum(h, 88104, 88112) || inNum(h, 88172, 88177);
const SURG_PATH = (h: string) => inNum(h, 88300, 88309);
const FLUID_STUDY = new Set(["89050", "89051", "89060", "82945", "84157", "83615", "82042", "87070", "87075", "87205"]);
export interface FollowOnFamily { id: string; label: string; expectedLabel: string; floor: number; trigger: (h: string) => boolean; expected: (g: ClaimGroup) => boolean; rec: string }
export const CC10_FAMILIES: FollowOnFamily[] = [
  { id: "fluid", label: "fluid procedure (thoracentesis, paracentesis, lumbar puncture, arthrocentesis)", expectedLabel: "a fluid study (cell count, chemistry, culture, crystals or cytology)", floor: 0.6,
    trigger: (h) => ["32554", "32555", "49082", "49083", "62270", "62328", "20600", "20604", "20605", "20606", "20610", "20611"].includes(h),
    expected: (g) => some(g.codes, (h) => FLUID_STUDY.has(h) || CYTOLOGY(h)),
    rec: "Sample the cases with no fluid study: confirm in the chart whether a specimen was sent, and add the lab charges where it was. Therapeutic-only taps and joint injections send no specimen and are expected gaps." },
  { id: "path", label: "tissue-sampling procedure (biopsy, polypectomy, fine needle aspiration)", expectedLabel: "a pathology or cytology charge (88300–88309, 88104–88112, 88172–88177)", floor: 0.8,
    trigger: (h) => ["11102", "11104", "11106", "19081", "19083", "19085", "19100", "19101", "31625", "31628", "38221", "38222", "43239", "44389", "45380", "45384", "45385", "47000", "50200", "55700", "10005", "10007", "10009", "10011", "10021"].includes(h),
    expected: (g) => some(g.codes, (h) => SURG_PATH(h) || CYTOLOGY(h)),
    rec: "Sample the cases with no pathology: confirm whether the specimen was read in-house and add the technical pathology charge. Exclude specimens sent to a reference lab that bills separately." },
  { id: "usguide", label: "central line placement", expectedLabel: "ultrasound guidance (76937)", floor: 0.4,
    trigger: (h) => ["36555", "36556", "36557", "36558", "36568", "36569"].includes(h),
    expected: (g) => g.codes.has("76937"),
    rec: "Sample the cases with no 76937: it is billable only with documented vessel patency, real-time needle visualization and a permanently recorded image. Add the charge where all three are in the chart." },
  { id: "cast", label: "closed fracture treatment", expectedLabel: "a cast or splint application or supply (29000–29590, Q4001–Q4051, A4570–A4590)", floor: 0.5,
    trigger: (h) => ["23500", "23505", "24500", "24505", "24650", "25500", "25530", "25600", "25605", "26600", "26605", "26720", "26725", "26750", "27750", "27752", "27786", "27788", "27808", "27810", "28470", "28475", "28490", "28510"].includes(h),
    expected: (g) => some(g.codes, (h) => inNum(h, 29000, 29590) || /^Q40([0-4]\d|5[01])$/.test(h) || ["A4570", "A4580", "A4590"].includes(h)),
    rec: "Sample the cases with no cast or splint line: confirm what was applied and add the supply charge. The first cast application is included in the fracture-care code; the supplies are not." },
];

export function runProcedureFollowOnRules(cdm: CdmLite[], claims: ClaimRow[]): ConvergeRuleResult[] {
  const idx = cdmIndex(cdm); const groups = groupClaims(claims); const out: ConvergeRuleResult[] = [];
  for (const fam of CC10_FAMILIES) {
    let n = 0, hit = 0; const freq = new Map<string, number>();
    for (const g of groups) {
      const t = firstOf(g.codes, fam.trigger); if (!t) continue;
      n++; freq.set(t, (freq.get(t) || 0) + 1); if (fam.expected(g)) hit++;
    }
    if (n < RATE_MIN_CLAIMS) continue;
    const rate = hit / n; if (rate >= fam.floor) continue;
    const line = rateAnchor(idx, freq); if (!line) continue;
    out.push({
      rule_id: `CC10.${fam.id}`, charge_item_id: line.id,
      title: `Low follow-on rate after ${fam.label.split(" (")[0]}`,
      description: `${hit} of ${n} claims (${Math.round(rate * 100)}%) with a ${fam.label} also carried ${fam.expectedLabel}. That is below the provisional review threshold of ${Math.round(fam.floor * 100)}%, leaving ${n - hit} claim(s) to sample. Not every case sends a specimen or uses guidance, so this is a rate to review, not a per-claim error.`,
      severity: n >= 20 ? "medium" : "low", category: "Charge Capture — Procedure Follow-On (Rate)",
      recommendation: fam.rec,
    });
  }
  return out;
}

// ── CC-11 · Administration family consistency (Rapid) ──
// Drug-class table from public HCPCS descriptors: J9xxx = chemotherapy / anti-neoplastic.
// Chemotherapy administration family = 96401–96549; non-chemotherapy = 96360–96379.
const isChemoDrug = (h: string) => /^J9\d{3}$/.test(h);
const isNonChemoDrug = (h: string) => /^J[0-8]\d{3}$/.test(h);
const isChemoAdmin = (h: string) => inNum(h, 96401, 96549);
const isNonChemoAdmin = (h: string) => inNum(h, 96360, 96379);
// Drugs whose descriptor is an injection-only product (IM/SC or push), never a timed infusion.
export const INJECTION_ONLY_DRUGS = new Set(["J3420", "J1030", "J1040", "J3301", "J1050", "J1885", "J2550"]);
const isInfusionOnlyAdmin = (h: string) => ["96365", "96366", "96367", "96368"].includes(h);
const isInjectionAdmin = (h: string) => ["96372", "96373", "96374", "96375", "96376", "96377"].includes(h);

export function runAdminFamilyRules(cdm: CdmLite[], claims: ClaimRow[]): ConvergeRuleResult[] {
  const idx = cdmIndex(cdm);
  const agg = new Map<string, { type: string; anchor: string; count: number }>();
  const bump = (type: string, anchor: string) => { const k = `${type}|${anchor}`; const e = agg.get(k) || { type, anchor, count: 0 }; e.count++; agg.set(k, e); };
  for (const g of groupClaims(claims)) {
    const chemoDrug = firstOf(g.codes, isChemoDrug);
    const hasChemoAdmin = some(g.codes, isChemoAdmin), hasNonChemoAdmin = some(g.codes, isNonChemoAdmin);
    // Chemotherapy drug carried only by a non-chemotherapy administration (under-coded family).
    if (chemoDrug && hasNonChemoAdmin && !hasChemoAdmin) bump("chemo_drug_nonchemo_admin", chemoDrug);
    // Chemotherapy administration with drugs on the claim but none from the chemotherapy class (over-coded family).
    if (hasChemoAdmin && !chemoDrug && some(g.codes, isNonChemoDrug)) bump("chemo_admin_no_chemo_drug", firstOf(g.codes, isChemoAdmin)!);
    // Injection-only drug with only a timed-infusion administration on the claim.
    const injDrug = firstOf(g.codes, (h) => INJECTION_ONLY_DRUGS.has(h));
    const otherDrugs = some(g.codes, (h) => (isNonChemoDrug(h) || isChemoDrug(h)) && !INJECTION_ONLY_DRUGS.has(h));
    if (injDrug && !otherDrugs && some(g.codes, isInfusionOnlyAdmin) && !some(g.codes, isInjectionAdmin)) bump("inj_drug_infusion_admin", injDrug);
  }
  const META: Record<string, { t: string; d: string; sev: ConvergeRuleResult["severity"]; rec: string }> = {
    chemo_drug_nonchemo_admin: { t: "Chemotherapy drug billed with a non-chemotherapy administration", d: "with a chemotherapy-class drug (J9xxx) but only non-chemotherapy administration codes (96360–96379). Direction: likely under-coded administration", sev: "high",
      rec: "Review the administration code: chemotherapy and other highly complex drugs are reported with 96401–96549. Confirm against the MAR and recode where supported." },
    chemo_admin_no_chemo_drug: { t: "Chemotherapy administration billed with no chemotherapy-class drug", d: "with a chemotherapy administration code (96401–96549) but no chemotherapy-class drug (J9xxx) on the claim. Direction: possible over-coded administration", sev: "medium",
      rec: "Confirm the drug qualifies for the chemotherapy administration family (certain monoclonal antibodies and biologic response modifiers billed under other J-codes do). Recode to 96360–96379 where it does not." },
    inj_drug_infusion_admin: { t: "Injection-only drug billed with an infusion administration", d: "with an injection-only drug but only timed-infusion administration codes (96365–96368). Direction: possible over-coded administration", sev: "medium",
      rec: "Confirm the route in the MAR. An IM/SC injection reports 96372 and an IV push reports 96374/96375; an infusion code needs documented infusion time." },
  };
  const out: ConvergeRuleResult[] = [];
  for (const e of agg.values()) {
    const line = idx.get(e.anchor); if (!line) continue; const m = META[e.type];
    out.push({ rule_id: `CC11.${e.type}`, charge_item_id: line.id, title: m.t,
      description: `${e.anchor} appears on ${e.count} claim(s) ${m.d}. Review prompt: confirm against the chart before acting.`,
      severity: m.sev, category: "Charge Capture — Administration Family", recommendation: m.rec });
  }
  return out;
}

// ── CC-12 · Payer-specific code substitution (Rapid) ──
const SIMPLE_REPAIR = (h: string) => inNum(h, 12001, 12018);
// Vaccine products with a Medicare administration G-code: influenza → G0008, pneumococcal → G0009, hepatitis B → G0010.
const FLU_VAX = (h: string) => ["90630", "90653", "90654", "90655", "90656", "90657", "90658", "90660", "90661", "90662", "90672", "90673", "90674", "90682", "90685", "90686", "90687", "90688", "90689", "90694", "90756"].includes(h);
const PNEUMO_VAX = (h: string) => ["90670", "90671", "90677", "90684", "90732"].includes(h);
const HEPB_VAX = (h: string) => ["90739", "90740", "90743", "90744", "90746", "90747", "90759"].includes(h);

export function runPayerSpecificRules(cdm: CdmLite[], claims: ClaimRow[]): ConvergeRuleResult[] {
  const idx = cdmIndex(cdm);
  const agg = new Map<string, { type: string; anchor: string; count: number }>();
  const bump = (type: string, anchor: string) => { const k = `${type}|${anchor}`; const e = agg.get(k) || { type, anchor, count: 0 }; e.count++; agg.set(k, e); };
  for (const g of groupClaims(claims)) {
    const medicare = isMedicare(g.payer); const payerKnown = !!g.payer;
    const trauma = g.revs.has("068"), cc = g.codes.has("99291"), g0390 = g.codes.has("G0390");
    // Trauma activation (068x) with critical care and no G0390 — Medicare, or payer not supplied.
    if (trauma && cc && !g0390 && (medicare || !payerKnown)) bump("trauma_no_g0390", "99291");
    // G0390 without both of its requirements on the claim.
    if (g0390 && (!trauma || !cc)) bump("g0390_unsupported", "G0390");
    // G0168 (adhesive-only closure) is a Medicare code; other payers generally expect the simple repair codes.
    if (g.codes.has("G0168") && payerKnown && !medicare) bump("g0168_nonmedicare", "G0168");
    if (g.codes.has("G0168") && some(g.codes, SIMPLE_REPAIR)) bump("g0168_with_repair", "G0168");
    // Medicare influenza / pneumococcal / hepatitis B vaccine given with a CPT administration code and no G-code.
    if (medicare && !g.codes.has("G0008") && !g.codes.has("G0009") && !g.codes.has("G0010") && (g.codes.has("90471") || g.codes.has("90472"))) {
      const v = firstOf(g.codes, (h) => FLU_VAX(h) || PNEUMO_VAX(h) || HEPB_VAX(h));
      if (v) bump("vaccine_gcode", v);
    }
  }
  const META: Record<string, { t: string; d: string; sev: ConvergeRuleResult["severity"]; rec: string }> = {
    trauma_no_g0390: { t: "Trauma activation with critical care and no G0390", d: "with trauma activation (revenue code 068x) and critical care (99291) but no G0390", sev: "high",
      rec: "For Medicare, report G0390 with 99291 when trauma team activation criteria are met and at least 30 minutes of critical care are provided. Confirm the activation level and pre-notification in the trauma log." },
    g0390_unsupported: { t: "G0390 without trauma activation and critical care on the claim", d: "with G0390 but without both revenue code 068x and 99291", sev: "medium",
      rec: "G0390 is payable only with a trauma activation revenue code (068x) and critical care (99291) on the same claim. Add the missing element if supported, or remove G0390." },
    g0168_nonmedicare: { t: "G0168 billed to a non-Medicare payer", d: "billed to a non-Medicare payer with G0168 (wound closure by tissue adhesive only)", sev: "low",
      rec: "G0168 is a Medicare code. Most other payers expect the simple repair codes (12001–12018) for adhesive closure. Confirm the payer's policy and add a payer-specific charge alternative." },
    g0168_with_repair: { t: "G0168 billed with a simple repair code", d: "with both G0168 and a simple repair code (12001–12018)", sev: "medium",
      rec: "A single wound is reported one way: G0168 for adhesive-only closure, or the repair code when sutures or staples are used. Keep both only for separate wounds, with documentation." },
    vaccine_gcode: { t: "Medicare vaccine given with a CPT administration code instead of the G-code", d: "on a Medicare claim with 90471/90472 and no G0008, G0009 or G0010", sev: "medium",
      rec: "Medicare administration of influenza, pneumococcal and hepatitis B vaccines is reported with G0008, G0009 and G0010. Build payer-specific administration charges so Medicare claims carry the G-code." },
  };
  const out: ConvergeRuleResult[] = [];
  for (const e of agg.values()) {
    const line = idx.get(e.anchor); if (!line) continue; const m = META[e.type];
    out.push({ rule_id: `CC12.${e.type}`, charge_item_id: line.id, title: m.t,
      description: `${e.anchor} appears on ${e.count} claim(s) ${m.d}. Verify the current CMS requirement before valuing.`,
      severity: m.sev, category: "Charge Capture — Payer-Specific Codes", recommendation: m.rec });
  }
  return out;
}

// ── CC-13 · ED diagnosis-triggered companions (expected rate by diagnosis group; Rapid) ──
const ED_LEVEL_3_5 = new Set(["99283", "99284", "99285"]);
export interface EdDxGroup { id: string; label: string; dx: string[]; expectedLabel: string; floor: number; expected: (h: string) => boolean; rec: string }
export const CC13_GROUPS: EdDxGroup[] = [
  { id: "chestpain", label: "chest pain (R07)", dx: ["R07"], expectedLabel: "an ECG tracing (93005)", floor: 0.8, expected: (h) => ECG.has(h),
    rec: "Sample the visits with no ECG: confirm the tracing in the chart and add 93005. Exclude tracings performed by EMS before arrival." },
  { id: "resp", label: "a respiratory diagnosis (J44, J45, R06.2)", dx: ["J44", "J45", "R062"], expectedLabel: "a breathing treatment (94640, or 94644 with 94645)", floor: 0.4, expected: (h) => INHALE_TREATMENT.has(h),
    rec: "Sample the visits with no breathing treatment: confirm whether one was given in the department and add the charge. Patients who self-administer an inhaler are expected gaps." },
  { id: "urinary", label: "a urinary diagnosis (N39.0, R30, R31)", dx: ["N390", "R30", "R31"], expectedLabel: "a urinalysis (81001–81003)", floor: 0.7, expected: (h) => URINALYSIS.has(h),
    rec: "Sample the visits with no urinalysis: confirm the test in the chart and add the charge. Check first whether urinalysis is billed inside a lab panel or as a point-of-care test under another code." },
];

export function runEdDxCompanionRules(cdm: CdmLite[], claims: ClaimRow[]): ConvergeRuleResult[] {
  const idx = cdmIndex(cdm); const groups = groupClaims(claims); const out: ConvergeRuleResult[] = [];
  for (const dg of CC13_GROUPS) {
    let n = 0, hit = 0; const freq = new Map<string, number>();
    for (const g of groups) {
      const level = firstOf(g.codes, (h) => ED_LEVEL_3_5.has(h)); if (!level) continue;
      if (![...g.dxs].some((d) => dg.dx.some((p) => d.startsWith(p)))) continue;
      n++; freq.set(level, (freq.get(level) || 0) + 1); if (some(g.codes, dg.expected)) hit++;
    }
    if (n < RATE_MIN_CLAIMS) continue;
    const rate = hit / n; if (rate >= dg.floor) continue;
    const line = rateAnchor(idx, freq); if (!line) continue;
    out.push({
      rule_id: `CC13.${dg.id}`, charge_item_id: line.id,
      title: `ED visits for ${dg.label.split(" (")[0]}: low companion rate`,
      description: `${hit} of ${n} level 3 to 5 ED visits (${Math.round(rate * 100)}%) with ${dg.label} carried ${dg.expectedLabel}. That is below the provisional review threshold of ${Math.round(dg.floor * 100)}%, leaving ${n - hit} visit(s) to sample.`,
      severity: n >= 20 ? "medium" : "low", category: "Charge Capture — Missing Ancillary (Dx)",
      recommendation: dg.rec,
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
