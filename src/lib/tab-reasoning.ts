// ─── Rules and reasoning, per Findings tab ───────────────────
// For each output tab: which rules feed it, what they test, and why the tab is in
// the report. Mirrors Greg Brazzel's "Output Tabs: Rules and Reasoning" (v1.0,
// November 2026) so the reviewer can see the logic behind a finding without
// leaving the page. `ref` is Greg's register number or companion-charge rule id.
//
// Tier: R = Rapid Assessment (claims files), F = Full Diagnostic (adds the
// chargemaster, utilization and setup facts), M = Remediation (chart samples).
//
// `validated: false` marks a rule whose code relationships were written from
// public coding knowledge and still need to be confirmed against the current CMS
// and CPT/HCPCS sources before a client relies on it.

import type { FindingBucket } from "./finding-buckets";

export interface TabRule {
  ref: string;
  name: string;
  tests: string;
  why: string;
  tier: "R" | "F" | "M" | "R/F";
  validated?: boolean; // default true
}

export interface TabReasoning {
  purpose: string;      // why the tab exists
  input: string;        // the file(s) that feed it
  contract: string;     // the output contract that governs the tab
  rules: TabRule[];
}

export const OUTPUT_CONTRACT =
  "Every flag is a review prompt, not a verdict. Dollars appear only where they are real; judgment findings carry a count and a reason, never a gross-dollar headline.";

export const TAB_REASONING: Record<FindingBucket, TabReasoning> = {
  cdm: {
    purpose: "The chargemaster itself: structure, coding, status indicators and pricing, line by line. This is the audit-trail master that every other tab traces back to.",
    input: "Charge Master (CDM), with Revenue & Usage for volume and dollars",
    contract: OUTPUT_CONTRACT,
    rules: [
      { ref: "#1 / #2", name: "Modifier issues", tests: "Lines that should carry a fixed modifier (laterality, TC/26, QW) but do not, hard-coded judgment modifiers, and modifiers that are not valid.", why: "A missing deterministic modifier denies or underpays on every claim and is a one-time CDM fix. Judgment modifiers depend on the encounter, so they are listed, not valued.", tier: "F" },
      { ref: "#19", name: "Add-on codes", tests: "Add-on codes with no qualifying primary on the CDM.", why: "An add-on cannot be paid without its primary.", tier: "R/F" },
      { ref: "#3", name: "Multiple revenue codes", tests: "One HCPCS mapped to two or more revenue codes.", why: "Inconsistent revenue codes distort cost-report department totals and can misroute payment.", tier: "F" },
      { ref: "#5", name: "Conditional packaging (SI=Q1 to Q4)", tests: "Lines with conditionally packaged status.", why: "Payment depends on what else is on the claim, so the standalone rate must not be assumed. A review list; no dollar headline.", tier: "F" },
      { ref: "#11", name: "Not recognized under OPPS (SI=B)", tests: "Codes OPPS does not recognize on a hospital outpatient claim, and whether an alternate code applies.", why: "These go out at $0 and create edits unless suppressed or replaced (for example G0463 for clinic visits).", tier: "F" },
      { ref: "#41", name: "Non-covered (SI=E1 / E2)", tests: "Statutorily excluded or non-paid lines not handled as non-covered.", why: "They need an ABN or non-covered handling or they deny with no patient billing path.", tier: "F" },
      { ref: "#6", name: "Pass-through and new technology (SI=G, H, J, K)", tests: "Pass-through drugs and devices, and their price against ASP.", why: "Pass-through status ends on a date; a code that loses it needs repricing and a new payment basis.", tier: "F" },
      { ref: "#7 / #9", name: "SI=A fee-schedule lines", tests: "Fee-schedule-paid lines priced below or far above the schedule.", why: "Medicare pays the lesser of charge or fee schedule, so a price below the schedule gives money away.", tier: "F" },
      { ref: "#20", name: "Retired and invalid codes", tests: "Codes deleted or replaced in the current code set, and codes that are not a valid CPT/HCPCS.", why: "Retired and invalid codes auto-deny. A mechanical fix with a stated replacement.", tier: "R/F" },
      { ref: "#4", name: "Price variance", tests: "The same HCPCS priced inconsistently across the chargemaster.", why: "Large unexplained variance is a standardization and transparency risk.", tier: "F" },
      { ref: "#17", name: "Underpriced vs. Medicare", tests: "CDM price below the fee-schedule floor or the target markup band.", why: "A low price loses the difference on every unit.", tier: "F" },
      { ref: "#10", name: "Bilateral pricing", tests: "Bilateral procedures not priced at the 1.75x payment target, or missing a laterality counterpart.", why: "Keeps bilateral pricing in line with how Medicare pays.", tier: "F" },
      { ref: "#22", name: "Zero price", tests: "CDM lines at $0, especially with active usage.", why: "A zero-price line in use creates claim edits and skews cost reports.", tier: "F" },
      { ref: "#13", name: "Duplicate lines", tests: "The same code, revenue code and price on more than one line.", why: "Duplicates cause inconsistent pricing and billing. A governance cleanup.", tier: "F" },
      { ref: "#31", name: "Device-procedure crosswalk", tests: "Device procedures and revenue code 278 lines with no device C-code.", why: "Medicare payment is affected when the device code is absent.", tier: "F" },
      { ref: "#21", name: "Vaccine administration codes", tests: "Reliance on 90471 where the Medicare vaccine G-codes are missing.", why: "Forgone administration payment.", tier: "F" },
      { ref: "#38", name: "Lab panel rebundling and CLFS pricing", tests: "Panels and their components both present, missing panels, and lab prices against the CLFS.", why: "Payers pay the panel; separate components get denied or recouped.", tier: "R/F" },
      { ref: "#43", name: "Nomenclature and missing data", tests: "Blank or unclear descriptions, missing revenue codes, missing HCPCS where one is required.", why: "A line that cannot be read or billed has to be cleaned before any other finding on it can be trusted.", tier: "F" },
    ],
  },
  charge_capture: {
    purpose: "Missed and mismatched charges. A claim shows only what was billed, so a missing charge is inferred from the pattern: a charge that normally accompanies another charge is absent from the same claim.",
    input: "Claims Extract (de-identified), joined to the Charge Master",
    contract: "Every flag is a review prompt valued by count and reason, never a gross-dollar headline. Rate tests report the facility's own rate against a provisional review threshold until its own history and a peer benchmark are loaded.",
    rules: [
      { ref: "CC-1", name: "Drug and administration companions", tests: "A drug line with no administration code on the same claim, the reverse, and an add-on infusion with no initial service.", why: "A drug or infusion charge without its administration is missed revenue. This is the exact-gap tier, so it runs in the Rapid.", tier: "R" },
      { ref: "CC-2", name: "OR anesthesia and recovery", tests: "An OR procedure with no facility anesthesia (037x) or recovery (071x) charge on the claim.", why: "Both are billable services that follow the case, unless the facility builds them into the OR level.", tier: "R", validated: false },
      { ref: "CC-3", name: "Blood product and transfusion", tests: "A blood product with no transfusion administration charge, and the reverse.", why: "Product and administration are billed together.", tier: "R", validated: false },
      { ref: "CC-4", name: "Device-dependent procedures", tests: "A device procedure with no device code or implant supply line.", why: "Medicare payment is affected when the device code is absent.", tier: "R" },
      { ref: "CC-5", name: "Vaccine product and administration", tests: "A vaccine product with no administration charge.", why: "Under-charged administration is common with multiple vaccines.", tier: "R" },
      { ref: "CC-6", name: "Specimen collection", tests: "A collection charge with no lab test on the claim.", why: "One collection charge per date is expected alongside the tests it was drawn for.", tier: "R" },
      { ref: "CC-7", name: "Imaging contrast and radiopharmaceuticals", tests: "A with-contrast exam with no contrast agent, a contrast agent with no with-contrast exam, and a nuclear medicine study with no radiopharmaceutical.", why: "Contrast and radiopharmaceuticals are separately charged and affect cost reporting even where Medicare packages them.", tier: "R", validated: false },
      { ref: "CC-8", name: "Hydration fluid and inhalation pairs", tests: "Hydration with a separately charged bulk IV fluid (over-charge), and an inhaled drug with no breathing treatment (missing charge).", why: "Tests both directions so the finding is not only upside.", tier: "R", validated: false },
      { ref: "CC-10", name: "Procedure follow-on charges", tests: "Fluid procedures with no fluid study, tissue sampling with no pathology, central lines with no ultrasound guidance, fracture care with no cast or splint supply, as an expected rate.", why: "Not every case sends a specimen or uses guidance, so the test compares a rate instead of flagging each case. Chart confirmation is remediation.", tier: "F", validated: false },
      { ref: "CC-11", name: "Administration family", tests: "A drug billed with an administration code from the wrong family: chemotherapy vs. non-chemotherapy, injection vs. infusion.", why: "A wrong family changes payment in either direction; direction is reported separately.", tier: "R", validated: false },
      { ref: "CC-12", name: "Payer-specific codes", tests: "Medicare-only substitutions: G0390 with trauma activation and critical care, G0168 for adhesive-only closure, vaccine G-codes.", why: "Easy claims-only checks that are missed when a facility codes generically.", tier: "R", validated: false },
      { ref: "CC-13", name: "ED diagnosis companions", tests: "Level 3 to 5 ED visits with a chest pain, respiratory or urinary diagnosis and no ECG, breathing treatment or urinalysis, as an expected rate by diagnosis group.", why: "Uses the diagnosis on the claim to make the ED companion test more precise than a visit-level gap.", tier: "R", validated: false },
    ],
  },
  claims: {
    purpose: "What the payer did with the claim: denials traced back to the chargemaster line that caused them, edits that deny or recoup, and prices against what was actually allowed.",
    input: "Claims Extract (de-identified), joined to the Charge Master and the NCCI reference",
    contract: OUTPUT_CONTRACT,
    rules: [
      { ref: "#37", name: "Denials and KPI", tests: "Recurring denial reasons by code, CARC and payer, with denied dollars, traced to the CDM line.", why: "The signature capability: a denial traced to the chargemaster line that caused it.", tier: "R" },
      { ref: "Join 1", name: "Pricing vs. paid", tests: "CDM price against the average payer-allowed amount for the code.", why: "A charge below the allowed amount caps reimbursement at the charge.", tier: "R/F" },
      { ref: "#35", name: "NCCI PTP unbundling", tests: "Column 1 / Column 2 code pairs billed together, with or without an allowed modifier.", why: "Unbundled pairs are denied or recouped.", tier: "R" },
      { ref: "#27", name: "NCCI MUE unit caps", tests: "Billed units above the Medically Unlikely Edit cap for a code.", why: "Units above the MUE deny the line.", tier: "R" },
      { ref: "#34", name: "Modifier 25 same-day E/M", tests: "An E/M and a minor procedure on the same claim without modifier 25 on the E/M.", why: "Missing 25 is a denial; unsupported 25 is an audit risk.", tier: "R" },
      { ref: "#29", name: "Billed but not in the CDM", tests: "Codes on claims that have no chargemaster line.", why: "A code billed outside the CDM has no governed price or revenue code.", tier: "R" },
    ],
  },
  item_master: {
    purpose: "Where supply and device setup in the item master disagrees with the chargemaster, so the charge that reaches the claim is wrong or missing.",
    input: "Item Master, joined to the Charge Master",
    contract: OUTPUT_CONTRACT,
    rules: [
      { ref: "#40 / CC-4", name: "Device and C-code setup", tests: "Item-master devices with a C-code whose linked CDM line is not set up as a device.", why: "A device that is not coded as one drops the C-code from the claim, which affects Medicare payment on device-dependent procedures.", tier: "F" },
      { ref: "#43", name: "Revenue-code agreement", tests: "Revenue code on the item differs from the revenue code on its CDM line.", why: "The claim follows the CDM; a mismatch means the item was built for a different billing path than the one it uses.", tier: "F" },
    ],
  },
  formulary: {
    purpose: "Drug units, NDC and formulary status. One place for the pharmacy director to see drug-related exposure.",
    input: "Formulary, joined to the Charge Master and ASP",
    contract: OUTPUT_CONTRACT,
    rules: [
      { ref: "#12", name: "Billing unit and UOM mismatch", tests: "Drug lines where the HCPCS billing unit differs from the package unit with no safe conversion.", why: "Wrong units mean under- or over-billing on every administration.", tier: "F" },
      { ref: "#18", name: "Inactive formulary", tests: "Drugs inactive in the formulary but still active in the CDM.", why: "Billing a drug that is not dispensed is a compliance and revenue problem.", tier: "F" },
      { ref: "#32", name: "NDC agreement", tests: "CDM NDC differs from the formulary NDC.", why: "Medicaid and some commercial payers deny without a correct NDC.", tier: "F" },
      { ref: "#14 to #16", name: "Self-administered drugs (revenue code 637)", tests: "Self-administered drugs billed under revenue code 637.", why: "Medicare does not pay for them in most settings.", tier: "F" },
      { ref: "#6", name: "Drug price vs. ASP", tests: "Billing-unit price many times the Medicare ASP.", why: "An extreme multiple usually signals a unit error, not a pricing choice.", tier: "F" },
    ],
  },
  rvu: {
    purpose: "Volume context: lines billed rarely or never, as candidates to review or retire.",
    input: "Revenue & Usage, joined to the Charge Master",
    contract: "Informational. These are review and retire candidates, not CDM errors.",
    rules: [
      { ref: "#22 / Join 2", name: "Dormancy and low volume", tests: "CDM lines at or below the low-volume threshold set at intake.", why: "Dormant lines carry maintenance cost and stale prices; priced-dormant and $0-dormant are different cleanups.", tier: "F" },
    ],
  },
  peer: {
    purpose: "Prices against named competitors and the CMS peer average, and the shoppable-service posting obligation.",
    input: "Peer price files (machine-readable files) and CMS benchmark data",
    contract: "Pricing position, not error. Yield relative to peers is context for a pricing decision.",
    rules: [
      { ref: "#44", name: "Price transparency", tests: "Shoppable-service pricing against the CMS requirement.", why: "A public-posting obligation with civil penalties.", tier: "F" },
      { ref: "Peer", name: "Named-competitor comparison", tests: "Charge below or above competitors' posted prices for the same code.", why: "Shows where the chargemaster sits in its own market.", tier: "F" },
      { ref: "Peer", name: "CMS peer average", tests: "Charge far below or above what peer hospitals charge in CMS data.", why: "A second, independent benchmark when competitor files are thin.", tier: "F" },
    ],
  },
};
