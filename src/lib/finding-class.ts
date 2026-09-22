// Fix-type classification for the Findings summary cards.
// The callout cards group findings by the KIND of work needed, so a reviewer can
// separate quick coding fixes from the pricing bulk:
//   code_validity — the code is present but wrong/suboptimal per coding rules, or
//                   priced below a required Medicare fee schedule (a compliance
//                   correction). Generally discrete, low-effort fixes.
//   pricing       — market/strategic pricing: peer & competitor comparisons, CMS
//                   benchmark, markup vs Medicare, and internal price variance.
//                   Usually the largest bucket.
//   data_quality  — the chargemaster data itself is missing/blank/duplicated or a
//                   single code sits on many lines, which must be cleaned before
//                   the line can be trusted.

export type FindingClass = "code_validity" | "pricing" | "data_quality" | "informational";

export const CLASS_LABELS: Record<FindingClass, string> = {
  code_validity: "Code Validity",
  pricing: "Pricing",
  data_quality: "Data Quality",
  informational: "Informational",
};

export const CLASS_BLURB: Record<FindingClass, string> = {
  code_validity: "Coding & fee-schedule fixes",
  pricing: "Market & benchmark pricing",
  data_quality: "Missing, duplicate or unclear data",
  informational: "Payment-status context, no fix",
};

export const CLASS_COLOR: Record<FindingClass, string> = {
  code_validity: "#0a6cff", // brand blue — the quick, high-certainty fixes
  pricing: "#7c3aed",       // violet — strategic pricing work
  data_quality: "#d97706",  // amber — cleanup
  informational: "#64748b", // slate — reference/status, not a defect
};

// Explicit map for every category the rule engine currently emits. Anything not
// listed falls through to the keyword heuristic below, so new rules still land
// somewhere sensible without a code change here.
const EXPLICIT: Record<string, FindingClass> = {
  // ── Informational: OPPS payment-status facts about a code, not CDM defects.
  //    High-volume by nature (Q/B status blanket a large share of outpatient
  //    codes); kept out of the fix-it counts so the real work is visible. ──
  "Conditional Packaging (SI=Q1-Q4)": "informational",
  "Bundled (SI=B)": "informational",
  "Pass-Through & New Technology": "informational",
  "RVU / Low Volume": "informational", // review/retire candidates, not CDM edits

  // ── Data quality: missing/blank/duplicate data, same code on many lines ──
  "Description": "data_quality",
  "Missing Code": "data_quality",
  "Supply - Missing HCPCS": "data_quality",
  "Duplicate": "data_quality",
  "Pricing - Missing": "data_quality",
  "Peer Pricing (Data Quality)": "data_quality",

  // ── Pricing: market/benchmark/markup + internal price variance ──
  "Medicare Markup (Above Target)": "pricing",
  "Medicare Markup (Underpriced)": "pricing",
  "Pass-Through ASP Markup": "pricing",
  "Peer Pricing (Named Competitors)": "pricing",
  "Pricing Benchmark (Peer Comparison)": "pricing",
  "Pricing Consistency": "pricing",
  "Consistency": "pricing",
  "Price Transparency (Shoppable Services)": "pricing",

  // ── Code validity: coding correctness + fee-schedule compliance ──
  "Add-On - Missing Primary": "code_validity",
  "Bilateral Pricing": "code_validity",
  "Billed Not In CDM (Claims)": "code_validity",
  "Billing Unit / Multiplier": "code_validity",
  "Claim Unit Outlier (Claims)": "code_validity",
  "Coding Opportunity": "code_validity",
  "Compliance": "code_validity",
  "Device-Procedure Crosswalk": "code_validity",
  "Inactive Formulary": "code_validity",
  "Lab - Panel/Component Bundling": "code_validity",
  "Lab - Revenue Leakage": "code_validity",
  "Laboratory Pricing (CLFS)": "code_validity",
  "Missing Modifier": "code_validity",
  "Modifier - Compliance Risk": "code_validity",
  "Modifier 25 Co-Billing (Claims)": "code_validity",
  "Multi Rev Code": "code_validity",
  "New / Recommended Codes": "code_validity",
  "Pharmacy Billing Unit": "code_validity",
  "Pharmacy NDC Mismatch": "code_validity",
  "Pharmacy UOM Mismatch": "code_validity",
  "Radiology - Incorrect Modifier": "code_validity",
  "Radiology - Missing Modifier": "code_validity",
  "Retired HCPCS": "code_validity",
  "Revenue Code Mismatch": "code_validity",
  "Revenue Code": "code_validity",
  "SI=A Non-OPPS Fee Schedule": "code_validity",
  "Self-Admin Drugs (Rev 637)": "code_validity",
  "Unbundling Modifier (Claims)": "code_validity",
  "Vaccine Admin Coding": "code_validity",
};

export function classForCategory(category: string | null | undefined): FindingClass {
  const raw = (category || "").trim();
  const hit = EXPLICIT[raw];
  if (hit) return hit;
  const c = raw.toLowerCase();
  // Fallback heuristic for any future/unknown category.
  if (/packaged|packaging|\bsi=|status indicator|pass-through|rvu|low volume/.test(c)) return "informational";
  if (/duplicate|missing (code|price|hcpcs)|no rev|blank|unclear|data quality|description/.test(c)) return "data_quality";
  if (/peer|competitor|benchmark|markup|consistency|transparency|shoppable|market/.test(c)) return "pricing";
  return "code_validity";
}

// Given every category present in a review, the subset that falls in a class —
// used to build an `.in("category", [...])` filter for the findings query.
export function categoriesInClass(allCategories: string[], cls: FindingClass): string[] {
  return allCategories.filter((c) => classForCategory(c) === cls);
}
