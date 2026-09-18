// ─── ChargeGuard Rule Catalog ────────────────────────────────
// Single source of truth for every check the scan performs, grouped by area so
// the client can activate or deactivate them on the Intake page. Each catalog
// item maps to one or more engine rule_ids (see scan-route-v2.ts, cdm-reference-
// rules.ts, claims-rules.ts, peer-rules.ts). Toggling an item off adds all of
// its rule_ids to the audit's disabled_rules list, and the scan skips them.
// Everything is ON by default (disabled_rules empty = all rules active).
//
// Facility type: each rule carries the facility types it applies to. Rules with
// no `facilities` list are universal charge-integrity checks that apply to every
// facility type. OPPS-specific rules (status indicators, APC/markup, bilateral,
// device C-code, laterality, shoppable, peer benchmarks) apply only to the
// outpatient settings. The Intake facility-type selector filters the list, and
// the scan only runs the rules for the selected facility type.

// ChargeGuard currently supports short-term acute care only. The type is kept as
// a single-member union so existing call sites compile unchanged, but there is no
// facility selection in the product anymore.
export type FacilityType = "short_term_acute";

export const DEFAULT_FACILITY: FacilityType = "short_term_acute";

export const FACILITY_TYPES: { value: FacilityType; label: string; note: string }[] = [
  { value: "short_term_acute", label: "Short-Term Acute Care", note: "Acute hospital billing outpatient (OPPS) and inpatient (IPPS). Full rule set." },
];

// Full rule set applies to short-term acute care.
const OPPS: FacilityType[] = ["short_term_acute"];

export interface RuleItem {
  key: string;
  name: string;
  desc: string;
  ids: string[];
  facilities?: FacilityType[]; // omitted = universal (all facility types)
}
export interface RuleGroup { group: string; items: RuleItem[] }

export const RULE_CATALOG: RuleGroup[] = [
  {
    group: "Missing data & structure",
    items: [
      { key: "no_rev", name: "No revenue code", desc: "The line has no UB-04 revenue code, so it can't be billed.", ids: ["S.2"] },
      { key: "missing_hcpcs", name: "Missing CPT/HCPCS", desc: "The revenue code needs a CPT/HCPCS code but none is set.", ids: ["S.4"], facilities: OPPS },
      { key: "vague_desc", name: "Unclear description", desc: "The description is blank or too generic to tell what the service is.", ids: ["S.3"] },
    ],
  },
  {
    group: "Coding & status indicators",
    items: [
      { key: "retired", name: "Retired code still active", desc: "The code was deleted from the current CPT/HCPCS list and will deny.", ids: ["12"] },
      { key: "si_b", name: "Bundled code (SI=B)", desc: "Medicare never pays this separately; it's bundled into the procedure.", ids: ["8.B"], facilities: OPPS },
      { key: "si_q", name: "Conditionally packaged (SI=Q1–Q4)", desc: "Paid separately only in certain claim combinations.", ids: ["8.Q"], facilities: OPPS },
      { key: "passthrough", name: "Pass-through / new technology", desc: "Pass-through drug/device (SI=J/K); checks pricing vs ASP.", ids: ["15", "15.ASP"], facilities: OPPS },
      { key: "unlisted", name: "Unlisted procedure code", desc: "An unlisted code that may have a specific alternative.", ids: ["3.3"], facilities: OPPS },
      { key: "vaccine", name: "Vaccine missing admin code", desc: "A vaccine is present but its admin G-code is not.", ids: ["2b"], facilities: OPPS },
      { key: "recommended", name: "Missing recommended codes", desc: "Common codes in a family that aren't in the CDM but likely should be.", ids: ["NC"], facilities: OPPS },
    ],
  },
  {
    group: "Pricing",
    items: [
      { key: "markup_band", name: "Underpriced vs Medicare (2.5x–3.0x)", desc: "Priced below 2.5x the MC Fee Schedule, or far above the 3.0x band.", ids: ["U", "MK.high"], facilities: OPPS },
      { key: "si_a", name: "SI=A below fee schedule", desc: "An SI=A code priced below its MPFS/CLFS rate.", ids: ["SIA"], facilities: OPPS },
      { key: "cms_bench", name: "Below/above CMS peer average", desc: "Charge far below or above what peer hospitals charge (CMS data).", ids: ["BM.low", "BM.high"], facilities: OPPS },
      { key: "peer", name: "Below/above competitor prices", desc: "Charge below or above the competitors' prices for the code.", ids: ["PC.low", "PC.high"], facilities: OPPS },
      { key: "peer_multiline", name: "Same code, multiple lines (peer)", desc: "One code on several lines at different prices; confirm coding.", ids: ["PC.multiline"], facilities: OPPS },
    ],
  },
  {
    group: "Pricing integrity (internal)",
    items: [
      { key: "zero_price", name: "Zero or missing price", desc: "An active line priced at $0.", ids: ["6.5"] },
      { key: "price_var", name: "Same code, different prices", desc: "One CPT/HCPCS priced inconsistently across the chargemaster.", ids: ["3.2", "3.2b"] },
      { key: "dupe", name: "Duplicate line", desc: "The same code, revenue code, and price appear on more than one line.", ids: ["1.11"] },
    ],
  },
  {
    group: "Revenue codes",
    items: [
      { key: "rev_cpt", name: "Revenue code / CPT mismatch", desc: "The CPT falls outside the expected range for its revenue code.", ids: ["1.3"], facilities: OPPS },
      { key: "dme_rev", name: "DME revenue code (0274)", desc: "A DME item not using revenue code 0274.", ids: ["1.7"] },
      { key: "blood_rev", name: "Blood product revenue code (038X)", desc: "A blood product not using an 038X revenue code.", ids: ["1.8"] },
      { key: "implant_rev", name: "Implant revenue code", desc: "An implant not using an implant revenue code.", ids: ["1.9"] },
      { key: "multi_rev", name: "Same code, multiple revenue codes", desc: "One HCPCS billed under several revenue codes.", ids: ["M"] },
    ],
  },
  {
    group: "Devices",
    items: [
      { key: "device_cpt", name: "Device procedure missing C-code", desc: "A device procedure without its required device C-code(s).", ids: ["2c.F"], facilities: OPPS },
      { key: "device_rev278", name: "Rev 278 device missing C-code", desc: "A revenue-code-278 device line with no C-code.", ids: ["2c.R"], facilities: OPPS },
    ],
  },
  {
    group: "Modifiers & laterality",
    items: [
      { key: "hardcoded_mod", name: "Hard-coded modifiers", desc: "Situational modifiers hard-coded in the CDM.", ids: ["2.4"], facilities: OPPS },
      { key: "bilateral_missing", name: "Bilateral missing RT/LT", desc: "A modifier-50 line with no RT/LT counterpart.", ids: ["10.B"], facilities: OPPS },
      { key: "bilateral_price", name: "Bilateral not priced at 1.75x", desc: "A bilateral line not priced at 1.75x the one-sided rate.", ids: ["10"], facilities: OPPS },
      { key: "rad_missing_lat", name: "Radiology missing laterality", desc: "A radiology code that needs LT/RT has none.", ids: ["R1"], facilities: OPPS },
      { key: "rad_bad_lat", name: "Laterality on non-lateral code", desc: "LT/RT applied to a code that shouldn't have it.", ids: ["R4"], facilities: OPPS },
    ],
  },
  {
    group: "Units & billing multiplier",
    items: [
      { key: "multiplier", name: "Wrong billing-unit multiplier", desc: "The billing-unit multiplier looks wrong for the code.", ids: ["7"] },
    ],
  },
  {
    group: "Pharmacy",
    items: [
      { key: "self_admin", name: "Self-administered drug (Rev 637)", desc: "A drug billed under revenue code 637.", ids: ["637"] },
      { key: "inactive_form", name: "Inactive drug still billed", desc: "A drug marked inactive in the formulary is still billed.", ids: ["INF"] },
      { key: "ndc", name: "NDC differs from formulary", desc: "The CDM's NDC doesn't match the formulary NDC.", ids: ["NDC"] },
      { key: "uom", name: "Unit-of-measure mismatch", desc: "The pharmacy unit doesn't match the formulary unit.", ids: ["UOM"] },
      { key: "pbu", name: "Drug price far above ASP", desc: "The billing-unit price is many times the Medicare ASP.", ids: ["PBU"] },
    ],
  },
  {
    group: "Labs",
    items: [
      { key: "panel_comp", name: "Panel + components both present", desc: "A panel and its component tests are both in the CDM (bundling risk).", ids: ["L1"] },
      { key: "panel_missing", name: "Panel missing, components present", desc: "All components are present but the panel isn't built.", ids: ["L2"] },
      { key: "lab_clfs", name: "Lab price vs CLFS", desc: "A lab priced below the 2.5x band or above 5x the CLFS rate.", ids: ["L3.low", "L3.high"] },
    ],
  },
  {
    group: "Add-on codes",
    items: [
      { key: "addon", name: "Add-on without primary", desc: "An add-on code with no primary procedure in the CDM.", ids: ["A1"], facilities: OPPS },
    ],
  },
  {
    group: "RVU / volume",
    items: [
      { key: "low_volume", name: "Low or no volume", desc: "A CPT/HCPCS line billed at or below the low-volume threshold (retire/review candidate).", ids: ["RVU.0", "RVU.low"] },
    ],
  },
  {
    group: "Compliance",
    items: [
      { key: "non_billable", name: "Non-billable / convenience item", desc: "A line that looks like a convenience or non-billable item.", ids: ["2.1"] },
    ],
  },
  {
    group: "Price transparency (shoppable services)",
    items: [
      { key: "shoppable", name: "Shoppable service checks", desc: "Required shoppable services missing, unpriced, or inpatient/DRG gaps.", ids: ["PT.drg", "PT.missing", "PT.unpriced"], facilities: OPPS },
    ],
  },
];

/** Does a rule apply to the given facility type? (no list = universal). */
export function ruleAppliesTo(item: RuleItem, ft: FacilityType): boolean {
  return !item.facilities || item.facilities.includes(ft);
}

/** Catalog filtered to the rules that apply to a facility type (empty groups dropped). */
export function catalogForFacility(ft: FacilityType): RuleGroup[] {
  return RULE_CATALOG
    .map((g) => ({ group: g.group, items: g.items.filter((i) => ruleAppliesTo(i, ft)) }))
    .filter((g) => g.items.length > 0);
}

/** All engine rule_ids that apply to a facility type (used to scope the scan). */
export function ruleIdsForFacility(ft: FacilityType): Set<string> {
  const s = new Set<string>();
  for (const g of RULE_CATALOG) for (const i of g.items) if (ruleAppliesTo(i, ft)) i.ids.forEach((id) => s.add(id));
  return s;
}
