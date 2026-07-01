import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { runReferenceRules, runDeviceCrosswalkRules, runCodingUpdateRules, runPriceTransparencyRules, runMultiplierRules, runFormularyRules } from "@/lib/cdm-reference-rules";

export const maxDuration = 60;

// ─── Types ───────────────────────────────────────────────────

interface RuleResult {
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  financial_impact?: number;
  recommendation: string;
  charge_item_id: string;
  rule_id: string;
}

// ─── Reference Data from Carol's CDM Review Tool ─────────────

// Revenue codes that REQUIRE a CPT/HCPCS code on outpatient claims
const REV_CODES_REQUIRING_HCPCS = [
  "025", "026", "027", "030", "031", "032", "033", "034", "035",
  "036", "037", "040", "041", "042", "043", "044", "045", "046",
  "047", "048", "049", "050", "051", "052", "053", "054", "055",
  "056", "057", "058", "059", "060", "061", "062", "063", "064",
  "070", "071", "072", "073", "074", "075", "076", "077", "078",
  "080", "082", "083", "084", "085", "088", "090", "091", "094",
];

// Lab Panel Crosswalk (from Carol's "Lab Panel Crosswalk" tab)
const LAB_PANELS: Record<string, { name: string; components: string[]; allRequired: boolean }> = {
  "80048": { name: "Basic Metabolic Panel (BMP)", components: ["82310", "82947", "84075", "84132", "84295", "84460", "84520", "82565"], allRequired: true },
  "80053": { name: "Comprehensive Metabolic Panel (CMP)", components: ["82310", "82947", "84075", "84132", "84295", "84460", "84520", "82565", "82040", "82248", "84155"], allRequired: true },
  "80061": { name: "Lipid Panel", components: ["82465", "83718", "84478"], allRequired: true },
  "80076": { name: "Hepatic Function Panel", components: ["82040", "82248", "84075", "84450", "84460", "84155"], allRequired: true },
  "85025": { name: "CBC w/ Differential", components: ["85027"], allRequired: true },
};

// Radiology Crosswalk (from Carol's "Radiology Crosswalk" tab)
const RADIOLOGY_LATERALITY: Record<string, { desc: string; lateralityReq: boolean; allowedMods: string[]; bilateral: string }> = {
  "77065": { desc: "Diagnostic Mammography Unilateral", lateralityReq: true, allowedMods: ["LT", "RT"], bilateral: "2 lines LT/RT" },
  "77066": { desc: "Diagnostic Mammography Bilateral", lateralityReq: false, allowedMods: [], bilateral: "N/A" },
  "76641": { desc: "Breast Ultrasound Complete", lateralityReq: true, allowedMods: ["LT", "RT"], bilateral: "2 lines" },
  "73030": { desc: "Shoulder X-ray", lateralityReq: true, allowedMods: ["LT", "RT", "50"], bilateral: "Payer dependent" },
  "73562": { desc: "Knee X-ray 3 views", lateralityReq: true, allowedMods: ["LT", "RT", "50"], bilateral: "2 lines preferred" },
  "73721": { desc: "MRI Lower Extremity", lateralityReq: true, allowedMods: ["LT", "RT"], bilateral: "2 lines" },
  "73221": { desc: "MRI Upper Extremity", lateralityReq: true, allowedMods: ["LT", "RT"], bilateral: "2 lines" },
  "93971": { desc: "Duplex Extremity Veins Unilateral", lateralityReq: true, allowedMods: ["LT", "RT"], bilateral: "2 lines" },
  // Codes that should NOT have laterality
  "74177": { desc: "CT Abdomen/Pelvis w contrast", lateralityReq: false, allowedMods: [], bilateral: "N/A" },
  "71260": { desc: "CT Chest w contrast", lateralityReq: false, allowedMods: [], bilateral: "N/A" },
  "72148": { desc: "MRI Lumbar Spine", lateralityReq: false, allowedMods: [], bilateral: "N/A" },
  "93970": { desc: "Duplex Extremity Veins Bilateral", lateralityReq: false, allowedMods: [], bilateral: "Already bilateral" },
};

// Add-On CPT Crosswalk (from Carol's "Add-On CPT Crosswalk" tab)
const ADDON_CODES: Record<string, { desc: string; primaryRange: string[]; primaryRequired: boolean }> = {
  "11046": { desc: "Debridement add-on", primaryRange: ["11042", "11043", "11044"], primaryRequired: true },
  "99153": { desc: "Moderate sedation add-on", primaryRange: ["99151", "99152", "99153", "99155", "99156", "99157"], primaryRequired: true },
  "64480": { desc: "Injection add-on", primaryRange: ["64479"], primaryRequired: true },
  "22585": { desc: "Spine add-on level", primaryRange: ["22554", "22558"], primaryRequired: true },
  "22614": { desc: "Spinal fusion add-on", primaryRange: ["22612", "22630"], primaryRequired: true },
  "22842": { desc: "Instrumentation add-on", primaryRange: ["22600", "22610", "22612", "22630", "22800"], primaryRequired: true },
  "76937": { desc: "US guidance add-on", primaryRange: ["36000", "36010", "36100", "36200", "36400", "36410", "36420", "36500"], primaryRequired: true },
  "77012": { desc: "CT guidance add-on", primaryRange: [], primaryRequired: true }, // primary is any 10000-69990
  "96366": { desc: "IV infusion add-on hour", primaryRange: ["96365"], primaryRequired: true },
};

// Keywords for various categories
const DME_KEYWORDS = [
  "wheelchair", "walker", "crutch", "brace", "prosthetic", "orthotic",
  "cpap", "bipap", "oxygen", "nebulizer", "commode", "cane", "bed",
  "mattress", "trapeze", "traction", "splint", "collar", "boot",
];

const BLOOD_KEYWORDS = [
  "whole blood", "packed red", "red blood cell", "rbc", "platelet",
  "plasma", "cryoprecipitate", "cryo", "fresh frozen", "ffp",
  "blood product", "transfusion", "blood component",
];

const IMPLANT_KEYWORDS = [
  "implant", "prosthesis", "prosthetic", "pacemaker", "defibrillator",
  "stent", "graft", "fixation", "screw", "plate", "rod", "cage",
  "mesh", "valve", "spacer", "anchor", "coil", "catheter implant",
  "neurostimulator", "cochlear", "lens implant", "joint replacement",
];

const NON_BILLABLE_KEYWORDS = [
  "convenience", "comfort item", "personal item", "telephone",
  "tv rental", "television", "guest meal", "guest tray",
  "take home", "take-home", "hygiene kit", "amenity",
  "cosmetic", "non-covered", "noncovered", "gown", "slipper", "robe",
  "self-care", "elective non-covered",
];

// Modifiers that should NEVER be hard-coded in CDM (from Carol's call notes)
const NEVER_HARDCODE_MODS = ["59", "XE", "XS", "XP", "XU", "25", "76", "77"];

// Revenue code to CPT range mapping
const REV_CODE_CPT_RANGES: Record<string, { min: number; max: number; alpha?: string[] }[]> = {
  "025": [{ min: 0, max: 0, alpha: ["J", "A", "C", "Q"] }],
  "026": [{ min: 96360, max: 96379 }],
  "030": [{ min: 80000, max: 89999 }],
  "031": [{ min: 80000, max: 89999 }],
  "032": [{ min: 70000, max: 76999 }],
  "033": [{ min: 77000, max: 77999 }],
  "034": [{ min: 78000, max: 79999 }],
  "035": [{ min: 70000, max: 76999 }],
  "036": [{ min: 10000, max: 69999 }],
  "037": [{ min: 100, max: 1999 }],
  "041": [{ min: 94000, max: 94999 }],
  "042": [{ min: 97000, max: 97999 }],
  "043": [{ min: 97000, max: 97999 }],
  "044": [{ min: 92500, max: 92700 }],
  "045": [{ min: 99281, max: 99285 }],
  "048": [{ min: 93000, max: 93999 }],
  "051": [{ min: 99201, max: 99499 }],
  "073": [{ min: 93000, max: 93042 }],
  "075": [{ min: 43200, max: 45398 }],
};

// ─── Rule Engine ─────────────────────────────────────────────

function runRules(items: any[]): RuleResult[] {
  const results: RuleResult[] = [];

  // Pre-compute groupings
  const codeGroups = new Map<string, any[]>();
  const revCodePrices = new Map<string, number[]>();
  const allCodeSet = new Set<string>(); // all CPT codes in CDM

  for (const item of items) {
    const code = item.hcpcs_cpt_code?.trim();
    const rev = item.revenue_code?.trim();
    const price = parseFloat(item.gross_charge) || 0;

    if (code) allCodeSet.add(code);
    if (code && rev) {
      const key = `${code}|${rev}`;
      if (!codeGroups.has(key)) codeGroups.set(key, []);
      codeGroups.get(key)!.push(item);
    }
    if (rev) {
      const rev3 = rev.substring(0, 3);
      if (!revCodePrices.has(rev3)) revCodePrices.set(rev3, []);
      if (price > 0) revCodePrices.get(rev3)!.push(price);
    }
  }

  // Compute medians for outlier detection
  const revCodeMedians = new Map<string, number>();
  for (const [rev3, prices] of revCodePrices) {
    if (prices.length >= 5) {
      const sorted = [...prices].sort((a, b) => a - b);
      revCodeMedians.set(rev3, sorted[Math.floor(sorted.length / 2)]);
    }
  }

  const flaggedDupes = new Set<string>();

  for (const item of items) {
    const desc = (item.charge_description || "").toLowerCase();
    const code = (item.hcpcs_cpt_code || "").trim();
    const rev = (item.revenue_code || "").trim();
    const rev3 = rev.substring(0, 3);
    const price = parseFloat(item.gross_charge) || 0;
    const mod1 = (item.modifier_1 || "").trim().toUpperCase();
    const mod2 = (item.modifier_2 || "").trim().toUpperCase();
    const mod3 = (item.modifier_3 || "").trim().toUpperCase();
    const allMods = [mod1, mod2, mod3].filter(Boolean);
    const procNum = item.procedure_number || item.id;

    // ─── Rule S.2: No Revenue Code ─────────────────────
    if (!rev) {
      results.push({
        rule_id: "S.2", charge_item_id: item.id,
        title: `No revenue code assigned - ${procNum}`,
        description: `Charge item "${item.charge_description}" (${procNum}) has no revenue code. Cannot bill on UB-04 without a revenue code.`,
        severity: "critical", category: "Missing Code",
        recommendation: "Assign the appropriate UB-04 revenue code based on the department and service type.",
      });
    }

    // ─── Rule S.4: Missing CPT/HCPCS ───────────────────
    if (!code && rev) {
      const requiresHcpcs = REV_CODES_REQUIRING_HCPCS.some((r) => rev3 === r || rev.startsWith(r));
      if (requiresHcpcs) {
        results.push({
          rule_id: "S.4", charge_item_id: item.id,
          title: `Revenue code ${rev} requires HCPCS - none assigned - ${procNum}`,
          description: `Charge item "${item.charge_description}" uses revenue code ${rev} which requires a CPT/HCPCS code on outpatient claims, but none is assigned.`,
          severity: "high", category: "Missing Code",
          recommendation: "Assign the appropriate CPT/HCPCS code for this service. Claims submitted without the required HCPCS will be denied.",
        });
      }
    }

    // ─── Rule S.3: Vague/Missing Description ───────────
    if (!desc || desc.length < 3 || ["misc", "other", "supply", "charge", "fee", "item"].includes(desc.trim())) {
      results.push({
        rule_id: "S.3", charge_item_id: item.id,
        title: `Vague or missing description - ${procNum}`,
        description: `Charge item ${procNum} has description "${item.charge_description || "(blank)"}" which is too vague to identify the service.`,
        severity: "medium", category: "Description",
        recommendation: "Update the charge description to clearly identify the service, supply, or procedure.",
      });
    }

    // ─── Rule 6.5: Zero/Null Price ─────────────────────
    if (price <= 0 && item.is_active !== false) {
      results.push({
        rule_id: "6.5", charge_item_id: item.id,
        title: `Zero or missing price - ${procNum} (${code || "no code"})`,
        description: `Active charge item "${item.charge_description}" has a price of $${price.toFixed(2)}.`,
        severity: "high", category: "Pricing - Missing",
        recommendation: "Set an appropriate charge amount or deactivate this line item if no longer in use.",
      });
    }

    // ─── Rule 6.6: Extreme Price Outlier ───────────────
    if (price > 0 && rev3 && revCodeMedians.has(rev3)) {
      const median = revCodeMedians.get(rev3)!;
      if (median > 0) {
        const ratio = price / median;
        if (ratio > 5) {
          results.push({
            rule_id: "6.6", charge_item_id: item.id,
            title: `Price outlier (${ratio.toFixed(1)}x median) - ${procNum}`,
            description: `"${item.charge_description}" is priced at $${price.toLocaleString()} which is ${ratio.toFixed(1)}x the median ($${median.toLocaleString()}) for revenue code family ${rev3}x.`,
            severity: "medium", category: "Pricing - Outlier",
            financial_impact: Math.abs(price - median),
            recommendation: "Review pricing. This item is significantly higher than similar services in the same department.",
          });
        } else if (ratio < 0.05 && price > 0) {
          results.push({
            rule_id: "6.6", charge_item_id: item.id,
            title: `Price outlier (${(ratio * 100).toFixed(1)}% of median) - ${procNum}`,
            description: `"${item.charge_description}" is priced at $${price.toFixed(2)} which is only ${(ratio * 100).toFixed(1)}% of the median ($${median.toLocaleString()}) for revenue code family ${rev3}x.`,
            severity: "medium", category: "Pricing - Outlier",
            financial_impact: Math.abs(median - price),
            recommendation: "Review pricing. This item is significantly lower than similar services. May indicate a data entry error.",
          });
        }
      }
    }

    // ─── Rule 1.7: DME Keyword Check ───────────────────
    if (DME_KEYWORDS.some((kw) => desc.includes(kw))) {
      if (rev3 !== "027" && rev !== "0274") {
        results.push({
          rule_id: "1.7", charge_item_id: item.id,
          title: `DME item may need revenue code 0274 - ${procNum}`,
          description: `"${item.charge_description}" appears to be a DME item but uses revenue code ${rev} instead of 0274.`,
          severity: "medium", category: "Revenue Code",
          recommendation: "Review if this item should use revenue code 0274 and an appropriate HCPCS L-code or A/E/K code.",
        });
      }
    }

    // ─── Rule 1.8: Blood Product Check ─────────────────
    if (BLOOD_KEYWORDS.some((kw) => desc.includes(kw))) {
      if (!rev.startsWith("038") && !rev.startsWith("039")) {
        results.push({
          rule_id: "1.8", charge_item_id: item.id,
          title: `Blood product may need 038X revenue code - ${procNum}`,
          description: `"${item.charge_description}" appears to be a blood product but uses revenue code ${rev}.`,
          severity: "high", category: "Revenue Code",
          recommendation: "Assign the appropriate 038X revenue code (0380-0389) for blood and blood component charges.",
        });
      }
    }

    // ─── Rule 1.9: Implant Check ───────────────────────
    if (IMPLANT_KEYWORDS.some((kw) => desc.includes(kw))) {
      if (!["0275", "0276", "0278"].includes(rev) && !rev.startsWith("027")) {
        results.push({
          rule_id: "1.9", charge_item_id: item.id,
          title: `Implant may need implant revenue code - ${procNum}`,
          description: `"${item.charge_description}" appears to be an implant but uses revenue code ${rev}.`,
          severity: "medium", category: "Revenue Code",
          recommendation: "Review if this item should use an implant-specific revenue code (0275 Pacemaker, 0276 Intraocular Lens, 0278 Other Implants).",
        });
      }
    }

    // ─── Rule 2.1: Non-Billable Keywords ───────────────
    if (NON_BILLABLE_KEYWORDS.some((kw) => desc.includes(kw))) {
      results.push({
        rule_id: "2.1", charge_item_id: item.id,
        title: `Possible non-billable item - ${procNum}`,
        description: `"${item.charge_description}" contains keywords suggesting this may be a convenience or non-billable item.`,
        severity: "critical", category: "Compliance",
        recommendation: "Verify this item is billable to Medicare/payers. If it is a patient convenience item, ensure it is excluded from payer billing.",
      });
    }

    // ─── Rule 2.4: Hard-Coded Modifiers (expanded) ─────
    const badMods = allMods.filter((m) => NEVER_HARDCODE_MODS.includes(m));
    if (badMods.length > 0) {
      results.push({
        rule_id: "2.4", charge_item_id: item.id,
        title: `Modifier ${badMods.join("/")} should not be hard-coded - ${procNum}`,
        description: `"${item.charge_description}" has modifier ${badMods.join("/")} hard-coded in the CDM. These are situational modifiers that should only be applied at the claim level.`,
        severity: "high", category: "Modifier - Compliance Risk",
        recommendation: `Remove hard-coded modifier ${badMods.join("/")} from the CDM. These modifiers should be applied during claim submission when clinically appropriate.`,
      });
    }

    // ─── Rule R1: Radiology Missing Laterality (Carol's Radiology QA) ──
    if (code && RADIOLOGY_LATERALITY[code]) {
      const radInfo = RADIOLOGY_LATERALITY[code];
      if (radInfo.lateralityReq) {
        const hasLaterality = allMods.some((m) => ["LT", "RT", "50"].includes(m));
        if (!hasLaterality) {
          results.push({
            rule_id: "R1", charge_item_id: item.id,
            title: `Missing laterality modifier for ${code} - ${procNum}`,
            description: `"${item.charge_description}" (${radInfo.desc}) requires LT/RT modifier but none is assigned. This causes claim denials and lost revenue.`,
            severity: "high", category: "Radiology - Missing Modifier",
            recommendation: `Split CDM line into two entries with LT and RT modifiers, or enforce modifier at charge entry. Bilateral billing method: ${radInfo.bilateral}.`,
          });
        }
      } else {
        // Flag codes that should NOT have laterality but do
        const hasLaterality = allMods.some((m) => ["LT", "RT"].includes(m));
        if (hasLaterality) {
          results.push({
            rule_id: "R4", charge_item_id: item.id,
            title: `Laterality modifier used on non-lateral code ${code} - ${procNum}`,
            description: `"${item.charge_description}" (${radInfo.desc}) has LT/RT modifier but this code is not a laterality code. This may cause claim errors.`,
            severity: "medium", category: "Radiology - Incorrect Modifier",
            recommendation: "Remove LT/RT modifier from this CDM line. This code does not require laterality.",
          });
        }
      }
    }

    // ─── Rule A1: Add-On Code Without Primary (Carol's Add-On QA) ──
    if (code && ADDON_CODES[code]) {
      const addon = ADDON_CODES[code];
      if (addon.primaryRequired) {
        // Check if any primary code exists in the CDM
        let hasPrimary = false;
        if (addon.primaryRange.length > 0) {
          hasPrimary = addon.primaryRange.some((p) => allCodeSet.has(p));
        } else if (code === "77012") {
          // CT guidance: primary is any surgical code 10000-69990
          hasPrimary = [...allCodeSet].some((c) => {
            const n = parseInt(c);
            return !isNaN(n) && n >= 10000 && n <= 69990;
          });
        }
        if (!hasPrimary) {
          results.push({
            rule_id: "A1", charge_item_id: item.id,
            title: `Add-on code ${code} without primary code in CDM - ${procNum}`,
            description: `"${item.charge_description}" (${addon.desc}) is an add-on code that requires a primary procedure code (${addon.primaryRange.join(", ") || "surgical range"}) but none was found in the CDM.`,
            severity: "high", category: "Add-On - Missing Primary",
            recommendation: `Ensure the primary procedure code is built in the CDM. Add-on codes cannot be billed without their corresponding primary code. Required primary: ${addon.primaryRange.join(", ") || "10000-69990"}.`,
          });
        }
      }
    }

    // ─── Rule L1: Lab Panel + Components Billed (Carol's Lab QA) ──
    if (code && LAB_PANELS[code]) {
      const panel = LAB_PANELS[code];
      // Check if any component codes also exist as separate CDM items
      const componentsInCDM = panel.components.filter((c) => allCodeSet.has(c));
      if (componentsInCDM.length > 0) {
        results.push({
          rule_id: "L1", charge_item_id: item.id,
          title: `Panel ${code} and components both in CDM - ${procNum}`,
          description: `"${panel.name}" (${code}) is in the CDM along with ${componentsInCDM.length} of its component codes (${componentsInCDM.slice(0, 5).join(", ")}${componentsInCDM.length > 5 ? "..." : ""}). If both panel and components are billed on the same claim, this creates an NCCI bundling risk.`,
          severity: "high", category: "Lab - Panel/Component Bundling",
          recommendation: "Verify CDM build ensures panel and individual components cannot be billed together on the same claim. Dual build (panel + individual) is acceptable only if claim logic prevents overlap.",
        });
      }
    }

    // ─── Rule L2: All Panel Components Present But Panel Missing ──
    // (Run once per panel, not per item - check after loop)

    // ─── Rule 1.3: Revenue Code / CPT Range Mismatch ──
    if (code && rev3 && REV_CODE_CPT_RANGES[rev3]) {
      const ranges = REV_CODE_CPT_RANGES[rev3];
      const codeNum = parseInt(code);
      const isAlpha = /^[A-Z]/.test(code);

      let matched = false;
      for (const range of ranges) {
        if (range.alpha && isAlpha) {
          if (range.alpha.some((prefix) => code.startsWith(prefix))) {
            matched = true;
            break;
          }
        } else if (!isAlpha && !isNaN(codeNum)) {
          if (codeNum >= range.min && codeNum <= range.max) {
            matched = true;
            break;
          }
        }
      }

      if (!matched && !isAlpha && !isNaN(codeNum)) {
        results.push({
          rule_id: "1.3", charge_item_id: item.id,
          title: `Revenue code ${rev} may not match CPT ${code} - ${procNum}`,
          description: `"${item.charge_description}" uses revenue code ${rev} with CPT ${code}. The CPT code falls outside the expected range for this revenue code family.`,
          severity: "high", category: "Revenue Code Mismatch",
          recommendation: "Verify the revenue code and CPT code are correctly paired. Mismatches cause claim denials.",
        });
      }
    }

    // ─── Rule 1.11: Duplicate Check ────────────────────
    if (code && rev) {
      const dupeKey = `${code}|${rev}|${price.toFixed(2)}`;
      const group = codeGroups.get(`${code}|${rev}`);
      if (group && group.length > 1 && !flaggedDupes.has(dupeKey)) {
        const samePrice = group.filter(
          (g) => (parseFloat(g.gross_charge) || 0).toFixed(2) === price.toFixed(2)
        );
        if (samePrice.length > 1) {
          flaggedDupes.add(dupeKey);
          results.push({
            rule_id: "1.11", charge_item_id: item.id,
            title: `Potential duplicate - ${code} / Rev ${rev} / $${price.toFixed(2)}`,
            description: `Found ${samePrice.length} charge items with the same HCPCS ${code}, revenue code ${rev}, and price $${price.toFixed(2)}.`,
            severity: "medium", category: "Duplicate",
            recommendation: `Review the ${samePrice.length} items sharing code ${code}, rev ${rev}, price $${price.toFixed(2)}. Remove duplicates if they represent the same service.`,
          });
        }
      }

      // Rule 3.2: Same code, different prices
      if (group && group.length > 1) {
        const prices = group.map((g) => parseFloat(g.gross_charge) || 0).filter((p) => p > 0);
        if (prices.length > 1) {
          const minP = Math.min(...prices);
          const maxP = Math.max(...prices);
          if (minP > 0 && maxP / minP > 1.2) {
            const varKey = `3.2|${code}|${rev}`;
            if (!flaggedDupes.has(varKey)) {
              flaggedDupes.add(varKey);
              results.push({
                rule_id: "3.2", charge_item_id: item.id,
                title: `Price variance for ${code} - $${minP.toFixed(2)} to $${maxP.toFixed(2)}`,
                description: `Code ${code} with revenue code ${rev} has ${group.length} entries with prices ranging from $${minP.toFixed(2)} to $${maxP.toFixed(2)} (${((maxP / minP - 1) * 100).toFixed(0)}% variance).`,
                severity: "low", category: "Consistency",
                financial_impact: maxP - minP,
                recommendation: "Review whether different prices for the same code are intentional (e.g., different units) or a data error.",
              });
            }
          }
        }
      }
    }

    // ─── Rule 3.3: Unlisted Code Check ─────────────────
    if (code && /^\d{5}$/.test(code) && code.endsWith("99")) {
      results.push({
        rule_id: "3.3", charge_item_id: item.id,
        title: `Unlisted code ${code} - review for specific alternative - ${procNum}`,
        description: `"${item.charge_description}" uses code ${code} which appears to be an unlisted/unspecified procedure code.`,
        severity: "medium", category: "Coding Opportunity",
        recommendation: "Review if a specific CPT/HCPCS code exists for this service. Unlisted codes require additional documentation and may delay reimbursement.",
      });
    }
  }

  // ─── Rule L2: Panel Missing But All Components Present ──
  for (const [panelCode, panel] of Object.entries(LAB_PANELS)) {
    if (!allCodeSet.has(panelCode)) {
      const componentsPresent = panel.components.filter((c) => allCodeSet.has(c));
      if (panel.allRequired && componentsPresent.length === panel.components.length) {
        results.push({
          rule_id: "L2", charge_item_id: items[0]?.id || "",
          title: `All components for ${panel.name} (${panelCode}) present but panel not built`,
          description: `All ${panel.components.length} required components for ${panel.name} are in the CDM (${componentsPresent.join(", ")}), but the panel code ${panelCode} is not built. This is a revenue leakage opportunity.`,
          severity: "high", category: "Lab - Revenue Leakage",
          recommendation: `Add panel CPT ${panelCode} (${panel.name}) to the CDM. Billing the panel instead of individual components maximizes reimbursement.`,
        });
      }
    }
  }

  return results;
}

// ─── API Route ───────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const sessionClient = await createSessionClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("org_id")
      .eq("id", user.id)
      .single();
    if (!userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { auditId } = await request.json();
    if (!auditId) {
      return NextResponse.json({ error: "Missing auditId" }, { status: 400 });
    }

    // Fetch ALL charge items (paginated)
    let allItems: any[] = [];
    let offset = 0;
    const PAGE_SIZE = 1000; // Supabase/PostgREST caps responses at 1000 rows; page in 1000s so all items are scanned

    while (true) {
      const { data, error } = await supabaseAdmin
        .from("charge_items")
        .select("id, procedure_number, charge_description, hcpcs_cpt_code, revenue_code, gross_charge, department, modifier_1, modifier_2, modifier_3, is_active, ndc_code")
        .eq("audit_id", auditId)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error("Fetch error:", JSON.stringify(error));
        return NextResponse.json({ error: "Failed to fetch charge items" }, { status: 500 });
      }

      if (!data || data.length === 0) break;
      allItems = allItems.concat(data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (allItems.length === 0) {
      return NextResponse.json({ error: "No charge items found for this audit" }, { status: 404 });
    }

    // Load R&U + formulary (by charge code) for the formulary rules, if present.
    const usageByCode = new Map<string, any>();
    const formularyByCode = new Map<string, any>();
    for (let off = 0; ; off += 1000) {
      const { data } = await supabaseAdmin.from("charge_usage").select("charge_code, units, gross").eq("audit_id", auditId).range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const u of data) if (u.charge_code) usageByCode.set(String(u.charge_code), u);
      if (data.length < 1000) break;
    }
    for (let off = 0; ; off += 1000) {
      const { data } = await supabaseAdmin.from("charge_formulary").select("charge_code, status, ndc, drug_name, pkg_amt, pkg_unit").eq("audit_id", auditId).range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const f of data) if (f.charge_code) formularyByCode.set(String(f.charge_code), f);
      if (data.length < 1000) break;
    }

    // Run all rules: self-contained structural rules + CMS reference-driven rules
    const ruleResults = [
      ...runRules(allItems),
      ...runReferenceRules(allItems),
      ...runDeviceCrosswalkRules(allItems),
      ...runCodingUpdateRules(allItems),
      ...runPriceTransparencyRules(allItems),
      ...runMultiplierRules(allItems),
      ...runFormularyRules(allItems, formularyByCode, usageByCode),
    ];

    // Get phases for mapping
    const { data: phases } = await supabaseAdmin
      .from("audit_phases")
      .select("id, phase_number")
      .eq("audit_id", auditId);

    const phaseMap: Record<string, string> = {};
    for (const p of phases || []) {
      phaseMap[p.phase_number] = p.id;
    }

    function ruleToPhase(ruleId: string): string | null {
      const prefix = ruleId.split(".")[0];
      const map: Record<string, number> = {
        "1": 1, "S": 1, "2": 2, "3": 3, "6": 6, "R": 1, "A": 1, "L": 1,
        // reference-driven rules
        "8": 3, "15": 3, "12": 1, "10": 6, "U": 6, "637": 2, "2c": 1,
        "SIA": 6, "2b": 2, "NC": 3, "M": 1, "PT": 6, "7": 2, "INF": 2, "NDC": 2, "UOM": 2, "PBU": 2,
      };
      const phaseNum = map[prefix];
      return phaseNum ? phaseMap[phaseNum] || null : null;
    }

    // Clear previous scan findings for this audit before re-inserting.
    // (Delete ALL for the audit — the prior `.like("title","%-%")` filter missed
    // findings whose titles have no hyphen, e.g. Multi Rev Code / New Codes, so
    // they accumulated as duplicates on every re-scan.)
    await supabaseAdmin
      .from("findings")
      .delete()
      .eq("audit_id", auditId);

    // Insert findings in batches
    const findings = ruleResults.map((r) => ({
      audit_id: auditId,
      phase_id: ruleToPhase(r.rule_id),
      org_id: userData.org_id,
      charge_item_id: r.charge_item_id,
      title: r.title,
      description: r.description,
      severity: r.severity,
      status: "open",
      category: r.category,
      financial_impact: r.financial_impact || null,
      recommendation: r.recommendation,
      created_by: user.id,
    }));

    const BATCH_SIZE = 500;
    let inserted = 0;
    for (let i = 0; i < findings.length; i += BATCH_SIZE) {
      const batch = findings.slice(i, i + BATCH_SIZE);
      const { error } = await supabaseAdmin.from("findings").insert(batch);
      if (error) {
        console.error(`Finding insert error at ${i}:`, JSON.stringify(error));
      } else {
        inserted += batch.length;
      }
    }

    // Update audit finding count
    const { count } = await supabaseAdmin
      .from("findings")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId);

    await supabaseAdmin
      .from("audits")
      .update({ total_findings: count || 0 })
      .eq("id", auditId);

    // Summary by rule
    const summary: Record<string, { count: number; severity: string }> = {};
    for (const r of ruleResults) {
      if (!summary[r.rule_id]) {
        summary[r.rule_id] = { count: 0, severity: r.severity };
      }
      summary[r.rule_id].count++;
    }

    return NextResponse.json({
      success: true,
      itemsScanned: allItems.length,
      findingsGenerated: inserted,
      totalFindings: count || 0,
      summary,
    });
  } catch (err: any) {
    console.error("Scan error:", err?.message || err);
    return NextResponse.json({ error: "Scan failed", detail: err?.message }, { status: 500 });
  }
}
// engine: structural rules + CMS reference-driven rules (Greg Brazzel methodology)
