// ─── Reference-Driven CDM Rules ──────────────────────────────
// Greg Brazzel methodology, the rules that require CMS reference data
// (Status Indicator, APC, fee schedule, ASP). Complements the self-contained
// structural rules in the scan route. Each function returns RuleResult[] using
// the same shape the scan route inserts as Findings.
//
// Coverage: Formula Library Step 8 (SI=B / SI=Q1-Q4), Step 15 (pass-through
// SI=J/K/G/H + ASP price audit), Step 12 (retired HCPCS), the "Underpriced vs
// MPFS" flag, and Step 10 (bilateral 1.75x pricing).

import { getReference, refNum, normalizeHcpcs } from "./cms-reference";
import { getProcDevice, classifyDevice, getVaccine, NEW_CODES } from "./device-crosswalk";
import ptData from "./price-transparency-data.json";

export interface RuleResult {
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  financial_impact?: number;
  recommendation: string;
  charge_item_id: string;
  rule_id: string;
}

const Q_PACKAGING: Record<string, string> = {
  Q1: "STV-packaged (paid separately only without a separately-payable S/T/V service)",
  Q2: "T-packaged (paid separately only without a separately-payable T service)",
  Q3: "Composite / context-dependent packaging",
  Q4: "Conditionally-packaged drug/biological/device (packaged unless billed alone)",
};

const PASS_THROUGH_SI: Record<string, string> = {
  J1: "Comprehensive APC (C-APC) primary service — most other items packaged",
  J2: "Comprehensive observation service",
  K: "Active transitional pass-through (separately payable — monitor for expiration)",
  K1: "Non-opioid pain mgmt (NOPAIN Act, 1/1/25–12/31/27) — exempt from C-APC packaging",
  G: "Drug/biological pass-through — paid at ASP + margin, outside the procedure APC",
  H: "Device pass-through — separate category payment",
};

function num(v: any): number {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function runReferenceRules(items: any[]): RuleResult[] {
  const out: RuleResult[] = [];

  // ── Per-item, reference-driven flags ──────────────────────
  for (const item of items) {
    const procNum = item.procedure_number || item.id;
    const price = num(item.gross_charge);
    const rev = (item.revenue_code || "").replace(/\.0+$/, "").trim();

    // ── Rev Code 637 — Self-Administered Drugs (Item 10) ────
    // CMS generally does not cover "usually self-administered" drugs billed by
    // a hospital outpatient department under Part B. Checked before the HCPCS
    // guard because many Rev 637 lines carry no HCPCS.
    if (rev === "637" || rev === "0637") {
      out.push({
        rule_id: "637", charge_item_id: item.id,
        title: `Self-administered drug (Rev 637) - ${procNum}`,
        description: `"${item.charge_description}" is billed under Revenue Code 637 (self-administered drugs). Drugs that are "usually self-administered" are not covered under Part B when billed by a hospital outpatient department, creating compliance exposure.`,
        severity: "high", category: "Self-Admin Drugs (Rev 637)",
        financial_impact: price || undefined,
        recommendation: "Confirm with clinical staff whether this drug is administered in the facility or dispensed for home use. If home use, remove it from Medicare/Medicaid billing. Verify a written self-administered drug policy exists.",
      });
    }

    const code = (item.hcpcs_cpt_code || "").trim();
    if (!code) continue;
    const ref = getReference(code);
    if (!ref) continue;

    const si = (ref.si || "").trim();

    // ── Step 12: Retired HCPCS ──────────────────────────────
    if ((ref.retired || "").toUpperCase() === "YES") {
      out.push({
        rule_id: "12", charge_item_id: item.id,
        title: `Retired HCPCS ${code} still active in CDM - ${procNum}`,
        description: `"${item.charge_description}" uses HCPCS ${code}, which is not present in the current-year CPT/HCPCS list (retired). Claims with deleted codes are denied.`,
        severity: "high", category: "Retired HCPCS",
        financial_impact: price || undefined,
        recommendation: "Replace with the current valid code per the CMS transmittal / AMA CPT annual update, or deactivate the line.",
      });
    }

    // ── Step 8: SI=B Bundled ────────────────────────────────
    if (si === "B") {
      out.push({
        rule_id: "8.B", charge_item_id: item.id,
        title: `Bundled code (SI=B) ${code} - ${procNum}`,
        description: `"${item.charge_description}" (${code}) carries OPPS Status Indicator B — Medicare bundles its payment into the related procedure's APC and never pays it separately on outpatient claims.`,
        severity: "medium", category: "Bundled (SI=B)",
        financial_impact: price || undefined,
        recommendation: "Confirm this line is not billed expecting separate payment. Keep for charge capture/cost tracking only; its reimbursement is included in the primary procedure's APC.",
      });
    }

    // ── Step 8: SI=Q1-Q4 Conditional Packaging ──────────────
    if (si in Q_PACKAGING) {
      out.push({
        rule_id: "8.Q", charge_item_id: item.id,
        title: `Conditionally packaged (SI=${si}) ${code} - ${procNum}`,
        description: `"${item.charge_description}" (${code}) carries SI=${si}: ${Q_PACKAGING[si]}. Separate payment depends on what else is billed on the same claim/date.`,
        severity: "medium", category: "Conditional Packaging (SI=Q1-Q4)",
        financial_impact: price || undefined,
        recommendation: "Validate claim-level billing combinations so this line is paid when eligible and not double-counted when packaged.",
      });
    }

    // ── Step 15: Pass-Through (SI=J1/J2/K/K1/G/H) + ASP audit ─
    if (si in PASS_THROUGH_SI) {
      out.push({
        rule_id: "15", charge_item_id: item.id,
        title: `Pass-through / C-APC code (SI=${si}) ${code} - ${procNum}`,
        description: `"${item.charge_description}" (${code}) carries SI=${si}: ${PASS_THROUGH_SI[si]}.`,
        severity: "high", category: "Pass-Through & New Technology",
        financial_impact: price || undefined,
        recommendation: si === "K1"
          ? "Confirm NOPAIN Act status and that the line is not bundled into a co-billed C-APC (J1) procedure. Verify dose-to-unit multiplier."
          : "Confirm separately-payable status is current (pass-throughs expire) and that pricing tracks ASP acquisition cost.",
      });

      // Drug pass-through priced far above ASP limit
      const asp = refNum(ref.asp);
      if (asp > 0 && price > 0 && price / asp > 3.0) {
        out.push({
          rule_id: "15.ASP", charge_item_id: item.id,
          title: `Pass-through drug priced ${(price / asp).toFixed(1)}x ASP - ${procNum}`,
          description: `"${item.charge_description}" (${code}) is priced $${price.toLocaleString()} vs an ASP limit of $${asp.toLocaleString()} (${(price / asp).toFixed(1)}x). Pass-through drugs should price near ASP acquisition cost.`,
          severity: "medium", category: "Pass-Through ASP Markup",
          financial_impact: price - asp,
          recommendation: "Review charge against ASP + markup policy; an extreme markup over ASP is a pricing-integrity and transparency risk.",
        });
      }
    }

    // ── SI=A non-OPPS fee schedule gap vs generic underpricing ──
    if (si === "A") {
      // SI=A codes are paid under a non-OPPS fee schedule (MPFS/CLFS), not OPPS.
      const rate = Math.max(refNum(ref.mc_fee), refNum(ref.clfs));
      if (rate > 0 && price > 0 && price < rate) {
        out.push({
          rule_id: "SIA", charge_item_id: item.id,
          title: `SI=A code priced below non-OPPS rate - ${code} - ${procNum}`,
          description: `"${item.charge_description}" (${code}, SI=A) is paid under a non-OPPS fee schedule (MPFS/CLFS), and is priced $${price.toFixed(2)} vs the fee schedule $${rate.toFixed(2)}.`,
          severity: "medium", category: "SI=A Non-OPPS Fee Schedule",
          financial_impact: rate - price,
          recommendation: `Raise the charge to at least the non-OPPS fee-schedule amount ($${rate.toFixed(2)}).`,
        });
      }
    } else {
      // ── Underpriced vs Medicare fee schedule (non SI=A codes) ──
      const mcFee = refNum(ref.mc_fee);
      if (mcFee > 0 && price > 0 && price < mcFee) {
        out.push({
          rule_id: "U", charge_item_id: item.id,
          title: `Charge below Medicare fee schedule - ${code} - ${procNum}`,
          description: `"${item.charge_description}" (${code}) is priced $${price.toFixed(2)}, below the Medicare fee schedule of $${mcFee.toFixed(2)}. Charging below the allowable leaves reimbursement on the table for non-Medicare payers and signals a pricing error.`,
          severity: "medium", category: "Underpriced vs Fee Schedule",
          financial_impact: mcFee - price,
          recommendation: "Raise the charge to at least the fee-schedule amount (per the facility's markup policy). Charges below the Medicare allowable cap payment from percent-of-charge payers.",
        });
      }
    }
  }

  // ── Step 10: Bilateral (Mod-50) 1.75x pricing ─────────────
  out.push(...runBilateralRules(items));

  return out;
}

/**
 * Device-Procedure Crosswalk (Formula Library Step 2c). Two directions:
 *  Forward  — a device-dependent procedure CPT is in the CDM but the required
 *             device C-code(s) are not, so the 13X claim hard-rejects in I/OCE.
 *  Reverse  — a Rev Code 278 implantable-device line has no HCPCS/C-code mapped
 *             (orphaned device charge), classified by description keyword.
 */
export function runDeviceCrosswalkRules(items: any[]): RuleResult[] {
  const out: RuleResult[] = [];
  const present = new Set<string>();
  for (const it of items) {
    const c = normalizeHcpcs(it.hcpcs_cpt_code);
    if (c) present.add(c);
  }

  for (const item of items) {
    const procNum = item.procedure_number || item.id;
    const codeN = normalizeHcpcs(item.hcpcs_cpt_code);
    const rev = (item.revenue_code || "").replace(/\.0+$/, "").trim();
    const price = num(item.gross_charge);

    // ── Forward: device-dependent CPT missing required C-code(s) ──
    if (codeN) {
      const pd = getProcDevice(codeN);
      if (pd && pd.ccodes.length) {
        const have = pd.ccodes.filter((cc) => present.has(normalizeHcpcs(cc)));
        const satisfied = pd.logic === "OR" ? have.length >= 1 : have.length === pd.ccodes.length;
        if (!satisfied) {
          const missing = pd.ccodes.filter((cc) => !present.has(normalizeHcpcs(cc)));
          const join = pd.logic === "OR" ? " or " : " and ";
          out.push({
            rule_id: "2c.F", charge_item_id: item.id,
            title: `Device procedure ${pd.cpt} missing required C-code (${missing.join(pd.logic === "OR" ? "/" : "+")}) - ${procNum}`,
            description: `"${item.charge_description}" (${pd.cpt}, ${pd.family}) is a device-dependent procedure. CMS I/OCE hard-rejects 13X claims unless the device C-code(s) ${pd.ccodes.join(join)} appear on the claim. ${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} not present in the CDM.`,
            severity: "critical", category: "Device-Procedure Crosswalk",
            financial_impact: price || undefined,
            recommendation: `Add device C-code(s) ${missing.join(", ")} (Rev Code 278) so procedure ${pd.cpt} passes I/OCE editing.`,
          });
        }
      }
    }

    // ── Reverse: Rev 278 implantable-device line with no HCPCS/C-code ──
    if ((rev === "278" || rev === "0278") && !codeN) {
      const cat = classifyDevice(item.charge_description);
      const ctip = cat && cat.ccodes.length ? ` Typical C-code(s) for ${cat.category}: ${cat.ccodes.join(", ")}.` : "";
      out.push({
        rule_id: "2c.R", charge_item_id: item.id,
        title: `Rev 278 device line missing C-code${cat ? ` (${cat.category})` : ""} - ${procNum}`,
        description: `"${item.charge_description}" is an implantable-device charge (Rev Code 278) with no HCPCS/C-code mapped. Unmapped device charges can't tie to the device-dependent procedure and risk I/OCE rejection and lost cost-report (CCR) capture.${ctip}`,
        severity: "high", category: "Device-Procedure Crosswalk",
        financial_impact: price || undefined,
        recommendation: `Map the appropriate HCPCS C-code to this device line${cat && cat.cptFamily.length ? `, and confirm a primary procedure CPT (${cat.cptFamily.join(", ")}) is co-billed` : ""}.`,
      });
    }
  }
  return out;
}

/**
 * Bilateral procedures (modifier 50) should price at 1.75x the unilateral
 * (RT/LT/base) rate, not 2.0x. Exclude surgical-range codes (<=69999) and
 * ProFee/Physician department rows. (Formula Library Step 10.)
 */
function runBilateralRules(items: any[]): RuleResult[] {
  const out: RuleResult[] = [];
  const byCode = new Map<string, any[]>();

  for (const item of items) {
    const code = (item.hcpcs_cpt_code || "").trim();
    if (!code) continue;
    const dept = (item.department || "").toLowerCase();
    if (dept.includes("pro fee") || dept.includes("profee") || dept.includes("physician")) continue;
    const n = parseInt(normalizeHcpcs(code), 10);
    if (!isNaN(n) && n <= 69999) continue; // exclude surgical range
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code)!.push(item);
  }

  const modsOf = (it: any) =>
    [it.modifier_1, it.modifier_2, it.modifier_3]
      .map((m) => (m || "").trim().toUpperCase())
      .filter(Boolean);

  for (const [code, group] of byCode) {
    const fifty = group.filter((it) => modsOf(it).includes("50"));
    if (fifty.length === 0) continue;

    const base = group.filter((it) => {
      const m = modsOf(it);
      return m.includes("RT") || m.includes("LT") || m.length === 0;
    });

    const procNum = fifty[0].procedure_number || fifty[0].id;

    // Missing RT/LT counterpart entirely
    const hasRT = group.some((it) => modsOf(it).includes("RT"));
    const hasLT = group.some((it) => modsOf(it).includes("LT"));
    if (!hasRT && !hasLT) {
      out.push({
        rule_id: "10.B", charge_item_id: fifty[0].id,
        title: `Mod-50 line for ${code} has no RT/LT counterpart - ${procNum}`,
        description: `Code ${code} has a bilateral (modifier 50) line but no RT or LT unilateral line anywhere in the CDM, so its price cannot be validated against the 1.75x rule.`,
        severity: "medium", category: "Bilateral Pricing",
        recommendation: "Add the unilateral RT/LT line, or confirm this is a legitimately bilateral-only procedure (e.g., orbits, mastoids).",
      });
      continue;
    }

    const basePrices = base.map((it) => num(it.gross_charge)).filter((p) => p > 0);
    if (basePrices.length === 0) continue;
    const basePrice = Math.min(...basePrices);
    const expected = basePrice * 1.75;

    for (const it of fifty) {
      const p = num(it.gross_charge);
      if (p <= 0) continue;
      const ratio = p / basePrice;
      if (ratio > 1.9) {
        out.push({
          rule_id: "10", charge_item_id: it.id,
          title: `Bilateral priced ${ratio.toFixed(2)}x unilateral (should be 1.75x) - ${procNum}`,
          description: `Code ${code} bilateral (Mod-50) line is $${p.toFixed(2)} = ${ratio.toFixed(2)}x the unilateral $${basePrice.toFixed(2)}. OPPS bilateral methodology pays 1.75x, not 2.0x.`,
          severity: "medium", category: "Bilateral Pricing",
          financial_impact: p - expected,
          recommendation: `Reprice the Mod-50 line to $${expected.toFixed(2)} (1.75x unilateral).`,
        });
      } else if (ratio < 1.75 && ratio >= 1.0) {
        out.push({
          rule_id: "10", charge_item_id: it.id,
          title: `Bilateral priced ${ratio.toFixed(2)}x unilateral (below 1.75x) - ${procNum}`,
          description: `Code ${code} bilateral (Mod-50) line is $${p.toFixed(2)} = ${ratio.toFixed(2)}x the unilateral $${basePrice.toFixed(2)}, below the 1.75x bilateral target. Lost repricing opportunity.`,
          severity: "low", category: "Bilateral Pricing",
          financial_impact: expected - p,
          recommendation: `Consider repricing the Mod-50 line up to $${expected.toFixed(2)} (1.75x unilateral).`,
        });
      }
    }
  }

  return out;
}

/**
 * Coding-update rules (Greg Brazzel methodology):
 *  - Vaccine admin G-codes (Step 2b): a qualifying vaccine is in the CDM but its
 *    required admin G-code (G0008/G0009/G0010) is not — silent ~$12.44/admin gap.
 *  - New / recommended codes: 2026 MRI-safety codes (76014-76019) absent from CDM.
 *  - Multi rev code: the same HCPCS billed under more than one revenue code.
 */
export function runCodingUpdateRules(items: any[]): RuleResult[] {
  const out: RuleResult[] = [];
  const present = new Set<string>();
  const revsByCode = new Map<string, Set<string>>();
  let hasNeuroStim = false;
  for (const it of items) {
    const c = normalizeHcpcs(it.hcpcs_cpt_code);
    if (!c) continue;
    present.add(c);
    if (["63650", "64561", "64590"].includes(c)) hasNeuroStim = true;
    const rev3 = (it.revenue_code || "").replace(/\.0+$/, "").trim().substring(0, 3);
    if (rev3) {
      if (!revsByCode.has(c)) revsByCode.set(c, new Set());
      revsByCode.get(c)!.add(rev3);
    }
  }

  // Vaccine admin G-code gaps
  for (const item of items) {
    const code = normalizeHcpcs(item.hcpcs_cpt_code);
    if (!code) continue;
    const v = getVaccine(code);
    if (v && v.requiresG && /^G\d{4}$/.test(v.gcode) && !present.has(normalizeHcpcs(v.gcode))) {
      out.push({
        rule_id: "2b", charge_item_id: item.id,
        title: `Vaccine ${code} missing admin G-code ${v.gcode} - ${item.procedure_number || item.id}`,
        description: `"${item.charge_description}" (${code}, ${v.vtype}) requires Medicare admin code ${v.gcode}, but ${v.gcode} is not in the CDM. 90471 pays without denying, so this is a silent ~$${v.gap.toFixed(2)}/administration revenue gap.`,
        severity: "medium", category: "Vaccine Admin Coding",
        financial_impact: v.gap || undefined,
        recommendation: `Add ${v.gcode} to the CDM and bill it (not 90471) for ${v.vtype} vaccine administrations.`,
      });
    }
  }

  // New / recommended codes absent from the CDM (once each)
  for (const nc of NEW_CODES) {
    if (!present.has(normalizeHcpcs(nc.code))) {
      out.push({
        rule_id: "NC", charge_item_id: items[0]?.id || "",
        title: `Recommended code ${nc.code} not in CDM (${nc.family})`,
        description: `${nc.code} (eff ${nc.effective}) — ${nc.desc} — is not in the CDM.${hasNeuroStim ? " Relevant: this facility bills neurostimulator procedures (63650/64561/64590), the population these MRI-safety codes apply to." : ""}`,
        severity: (nc.priority || "").toUpperCase() === "HIGH" ? "medium" : "low",
        category: "New / Recommended Codes",
        recommendation: `Add ${nc.code} to the CDM (priority: ${nc.priority || "review"}).`,
      });
    }
  }

  // Multi rev code: same HCPCS under more than one revenue code
  for (const [code, revs] of revsByCode) {
    if (revs.size > 1) {
      const it = items.find((x) => normalizeHcpcs(x.hcpcs_cpt_code) === code);
      out.push({
        rule_id: "M", charge_item_id: it?.id || "",
        title: `HCPCS ${code} billed under ${revs.size} revenue codes (${[...revs].join(", ")})`,
        description: `Code ${code} appears in the CDM under multiple revenue codes (${[...revs].join(", ")}). Inconsistent revenue-code assignment for one HCPCS can cause edits/denials and inconsistent payment.`,
        severity: "low", category: "Multi Rev Code",
        recommendation: "Confirm the correct revenue code for this HCPCS and consolidate, unless the multiple assignments are intentional (e.g., different departments).",
      });
    }
  }

  return out;
}

// Known HCPCS billing-unit / multiplier traps (Formula Library Step 7). These
// codes are billed per a sub-unit, so the CDM HCPCS multiplier must be set or the
// line is massively under-billed. Greg flagged A9585 and J1885 specifically.
const MULTIPLIER_CODES: Record<string, { mult: string; note: string }> = {
  A9585: { mult: "10", note: "Gadobutrol/Gadavist is billed per 0.1 mL — multiplier must be 10 (e.g., 1 mL = 10 units). Multiplier of 1 under-bills ~90% per scan." },
  J1885: { mult: "per 15 mg", note: "Ketorolac is billed per 15 mg — a 60 mg dose = 4 units. Multiplier of 1 under-bills 75%." },
};

/** Step 7 — HCPCS billing-unit / multiplier audit (curated known-issue codes). */
export function runMultiplierRules(items: any[]): RuleResult[] {
  const out: RuleResult[] = [];
  for (const item of items) {
    const code = normalizeHcpcs(item.hcpcs_cpt_code);
    if (!code) continue;
    const m = MULTIPLIER_CODES[code];
    if (m) {
      out.push({
        rule_id: "7", charge_item_id: item.id,
        title: `Verify HCPCS multiplier for ${code} (should be ${m.mult}) - ${item.procedure_number || item.id}`,
        description: `"${item.charge_description}" (${code}) is a sub-unit-billed drug. ${m.note}`,
        severity: "high", category: "Billing Unit / Multiplier",
        financial_impact: num(item.gross_charge) || undefined,
        recommendation: `Confirm the CDM HCPCS multiplier/units for ${code} (${m.mult}) so the full dose is billed.`,
      });
    }
  }
  return out;
}

function normalizeNdc(v: any): string { const d = String(v ?? "").replace(/\D/g, ""); if (!d) return ""; return d.length <= 11 ? d.padStart(11, "0") : d; }

// Parse a dosage/unit string ("per 0.25 mg", "10 MG", "1 ea") → amount + unit + dimension.
function unitDim(u: string): string {
  const s = u.toLowerCase();
  if (/\b(mg|g|gram|mcg|microgram)\b/.test(s)) return "mass";
  if (/\b(ml|milliliter|l|liter|cc)\b/.test(s)) return "volume";
  if (/\b(iu|i\.u\.)\b/.test(s)) return "iu";
  if (/\b(ea|each|vial|dose|unit|tablet|capsule|billing unit)\b/.test(s)) return "count";
  return "";
}
function parseDosage(s: any): { amt: number; unit: string; dim: string } {
  const str = String(s ?? "").trim();
  const m = str.match(/([\d.]+)\s*([a-zA-Z.]+)/);
  const amt = m ? parseFloat(m[1]) : 0;
  const unit = m ? m[2] : str.replace(/per|each/gi, "").trim();
  return { amt: isNaN(amt) ? 0 : amt, unit, dim: unitDim(str || unit) };
}

/**
 * Formulary rules (need an imported formulary + R&U):
 *  - Inactive Formulary: drug is INACTIVE in the formulary but still has billing
 *    activity (R&U units > 0) — formulary/CDM out of sync.
 *  - Pharmacy NDC Mismatch: the CDM's NDC differs from the formulary's NDC.
 */
export function runFormularyRules(items: any[], formularyByCode: Map<string, any>, usageByCode: Map<string, any>): RuleResult[] {
  const out: RuleResult[] = [];
  for (const item of items) {
    const code = String(item.procedure_number ?? "").trim();
    if (!code) continue;
    const fm = formularyByCode.get(code);
    if (!fm) continue;
    const u = usageByCode.get(code);
    const billedUnits = u ? num(u.units) : 0;
    const gross = u ? num(u.gross) : num(item.gross_charge);

    if (/INACT/i.test(fm.status || "") && billedUnits > 0) {
      out.push({
        rule_id: "INF", charge_item_id: item.id,
        title: `Inactive formulary drug still billed - ${code}`,
        description: `"${item.charge_description}" (${fm.drug_name || code}) is marked INACTIVE in the formulary but had ${Math.round(billedUnits).toLocaleString()} billed units in the R&U period. The formulary and CDM are out of sync.`,
        severity: "high", category: "Inactive Formulary",
        financial_impact: gross || undefined,
        recommendation: "Inactivate the CDM line, or reactivate the formulary item if the drug is still stocked and dispensed.",
      });
    }
    const cdmN = normalizeNdc(item.ndc_code), fmN = normalizeNdc(fm.ndc);
    if (cdmN && fmN && cdmN !== fmN) {
      out.push({
        rule_id: "NDC", charge_item_id: item.id,
        title: `CDM NDC differs from formulary NDC - ${code}`,
        description: `"${item.charge_description}" has CDM NDC ${item.ndc_code} but the formulary lists NDC ${fm.ndc}${fm.drug_name ? ` (${fm.drug_name})` : ""}. Mismatched NDCs cause claim and pricing errors.`,
        severity: "medium", category: "Pharmacy NDC Mismatch",
        financial_impact: gross || undefined,
        recommendation: "Reconcile the CDM NDC with the formulary's NDC of record.",
      });
    }

    // ── Billing-unit / UOM (Step 7): needs ASP limit + HCPCS dosage + formulary pkg ──
    const ref = getReference(item.hcpcs_cpt_code);
    const asp = ref ? refNum(ref.asp) : 0;
    const price = num(item.gross_charge);
    if (asp > 0 && price > 0 && ref?.dosage) {
      const dose = parseDosage(ref.dosage);
      const pkgDim = unitDim(String(fm.pkg_unit || ""));
      if (dose.dim && pkgDim && dose.dim !== pkgDim) {
        out.push({
          rule_id: "UOM", charge_item_id: item.id,
          title: `Pharmacy UOM mismatch - ${code} (${dose.unit} vs ${fm.pkg_unit})`,
          description: `"${item.charge_description}" bills per ${ref.dosage} (${dose.dim}) but the formulary package is in ${fm.pkg_unit} (${pkgDim}). These units are dimensionally incompatible, so per-unit pricing can't be validated without drug-specific concentration data.`,
          severity: "high", category: "Pharmacy UOM Mismatch",
          financial_impact: gross || undefined,
          recommendation: "Have pharmacy supply the concentration / units-per-vial so the billing-unit price can be validated.",
        });
      } else {
        const ratio = price / asp;
        if (ratio >= 10) {
          const unitsPerVial = dose.amt > 0 && num(fm.pkg_amt) > 0 ? num(fm.pkg_amt) / dose.amt : 0;
          const correctPerUnit = unitsPerVial > 0 ? price / unitsPerVial : 0;
          out.push({
            rule_id: "PBU", charge_item_id: item.id,
            title: `Pharmacy billing-unit price ${ratio.toFixed(0)}x ASP - ${code}`,
            description: `"${item.charge_description}" is priced $${price.toFixed(2)} vs an ASP limit of $${asp.toFixed(2)} per ${ref.dosage} (${ratio.toFixed(0)}x). The CDM price looks set per package/vial while Medicare reimburses per billing unit${unitsPerVial > 0 ? ` (~${Math.round(unitsPerVial)} units/vial → correct ≈ $${correctPerUnit.toFixed(2)}/unit)` : ""}.`,
            severity: ratio > 50 ? "critical" : "high", category: "Pharmacy Billing Unit",
            financial_impact: gross || undefined,
            recommendation: `Confirm whether this is a per-vial or per-unit charge code; reprice to the per-billing-unit basis${unitsPerVial > 0 ? ` (~$${correctPerUnit.toFixed(2)}/unit)` : ""}.`,
          });
        }
      }
    }
  }
  return out;
}

interface ShoppableService { n: number; desc: string; codes: string[]; category: string; }

/**
 * Price Transparency — 70 CMS-specified shoppable services (45 CFR §180).
 * CDM-layer check only: is each service present in the CDM and priced?
 *  - present + priced  -> compliant (no flag)
 *  - present + $0       -> "in CDM, not priced" (catches e.g. 93000 ECG)
 *  - absent            -> "not in CDM" (confirm offered, or add). DRG/inpatient
 *    services have no outpatient HCPCS and are noted as inpatient.
 */
export function runPriceTransparencyRules(items: any[]): RuleResult[] {
  const out: RuleResult[] = [];
  const priceByCode = new Map<string, number>();
  for (const it of items) {
    const c = normalizeHcpcs(it.hcpcs_cpt_code);
    if (!c) continue;
    const p = num(it.gross_charge);
    if (p > (priceByCode.get(c) ?? -1)) priceByCode.set(c, p);
  }
  const firstId = items[0]?.id || "";
  for (const s of (ptData.shoppableServices as ShoppableService[])) {
    const codes = s.codes.map((c) => normalizeHcpcs(c)).filter(Boolean);
    if (codes.length === 0) {
      out.push({
        rule_id: "PT.drg", charge_item_id: firstId,
        title: `Shoppable service not in CDM (inpatient/DRG) - ${s.desc}`,
        description: `CMS shoppable service "${s.desc}" is DRG/inpatient-based and won't appear in an outpatient CDM. Confirm coverage via the inpatient DRG table for price-transparency compliance.`,
        severity: "low", category: "Price Transparency (Shoppable Services)",
        recommendation: "Confirm this DRG-based shoppable service is published in the inpatient price-transparency file.",
      });
      continue;
    }
    const presentCodes = codes.filter((c) => priceByCode.has(c));
    if (presentCodes.length === 0) {
      out.push({
        rule_id: "PT.missing", charge_item_id: firstId,
        title: `Shoppable service not in CDM - ${s.codes.join("/")} - ${s.desc}`,
        description: `CMS-required shoppable service "${s.desc}" (${s.codes.join("/")}) is not in the CDM. Either the service isn't offered (document as "not offered") or the HCPCS needs to be added for price-transparency compliance.`,
        severity: "medium", category: "Price Transparency (Shoppable Services)",
        recommendation: `Confirm whether this service is offered; if so, add ${s.codes.join("/")} to the CDM with a price.`,
      });
      continue;
    }
    const maxPrice = Math.max(...presentCodes.map((c) => priceByCode.get(c) || 0));
    if (maxPrice <= 0) {
      const it = items.find((x) => presentCodes.includes(normalizeHcpcs(x.hcpcs_cpt_code)));
      out.push({
        rule_id: "PT.unpriced", charge_item_id: it?.id || firstId,
        title: `Shoppable service in CDM but unpriced - ${s.codes.join("/")} - ${s.desc}`,
        description: `CMS shoppable service "${s.desc}" (${s.codes.join("/")}) is in the CDM with a $0 price. Required shoppable services must carry a price for transparency compliance.`,
        severity: "high", category: "Price Transparency (Shoppable Services)",
        recommendation: `Assign a price to ${s.codes.join("/")} immediately (no client input needed).`,
      });
    }
  }
  return out;
}
