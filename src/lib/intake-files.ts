import type { FacilityType } from "./rule-catalog";

// ChargeGuard supports short-term acute care hospitals. Every review needs the
// same three core files below; there is no per-facility file matrix anymore.
//
// handler: which importer parses the file into the database.
// spec: the column contract for the file, surfaced in the UI as a downloadable
// template / spec so clients send the right shape the first time.

export type IntakeHandler = "cdm" | "ru" | "formulary" | "claims_extract" | "item_master" | "gl" | null;

export interface IntakeColumn {
  name: string;      // canonical column name shown in the spec
  required: boolean;
  desc: string;
}

export interface IntakeFile {
  key: string;
  title: string;
  desc: string;
  accepts: string;
  required: boolean;
  handler: IntakeHandler;
  countKey?: "cdm" | "ru" | "formulary" | "claims_extract" | "item_master" | "gl";
  spec: IntakeColumn[];
}

const CDM: IntakeFile = {
  key: "cdm",
  title: "Charge Master (CDM)",
  desc: "Your current chargemaster file. One row per charge line.",
  accepts: "Excel (.xlsx) or CSV",
  required: true,
  handler: "cdm",
  countKey: "cdm",
  spec: [
    { name: "Charge Code", required: true, desc: "Your internal charge/procedure number (unique per line)." },
    { name: "Description", required: true, desc: "Charge description as it appears in the CDM." },
    { name: "HCPCS/CPT", required: false, desc: "HCPCS or CPT code. Leave blank if the line has none." },
    { name: "Modifier 1/2/3", required: false, desc: "Any modifiers hard-coded on the CDM line." },
    { name: "Revenue Code", required: true, desc: "UB-04 revenue code (3 or 4 digit)." },
    { name: "Price", required: true, desc: "Current gross charge / price for the line." },
    { name: "Units / Multiplier", required: false, desc: "HCPCS billing-unit multiplier if set." },
    { name: "Effective Date", required: false, desc: "Date the code/line became effective (used to skip codes not yet effective in the review period)." },
  ],
};

const RU: IntakeFile = {
  key: "ru",
  title: "Revenue & Usage",
  desc: "Revenue and usage by charge code. Drives materiality and payer-impact ranking.",
  accepts: "Excel (.xlsx) or CSV",
  required: true,
  handler: "ru",
  countKey: "ru",
  spec: [
    { name: "Charge Code", required: true, desc: "Must match the CDM charge code." },
    { name: "HCPCS/CPT", required: false, desc: "HCPCS/CPT actually billed." },
    { name: "Modifier", required: false, desc: "Modifier actually billed in the utilization data (drives the missing-modifier check)." },
    { name: "Department", required: false, desc: "Reporting department for the line." },
    { name: "Units", required: true, desc: "Annual billed units (drives volume / RVU low-volume analysis)." },
    { name: "Gross Charges", required: true, desc: "Annual gross charges." },
    { name: "Visits", required: false, desc: "Annual visit / claim count." },
    { name: "Medicare $ / MC Adv / MC+MA", required: false, desc: "Payer-mix dollars for payer-impact ranking." },
  ],
};

const FORMULARY: IntakeFile = {
  key: "formulary",
  title: "Formulary",
  desc: "Pharmacy formulary with NDC and package units. Validates drug billing units and NDC-to-HCPCS mapping.",
  accepts: "Excel (.xlsx) or CSV",
  required: true,
  handler: "formulary",
  countKey: "formulary",
  spec: [
    { name: "Drug Name", required: true, desc: "Formulary drug description." },
    { name: "NDC", required: true, desc: "11-digit NDC." },
    { name: "HCPCS", required: false, desc: "Billing HCPCS (J-code) for the drug." },
    { name: "Package / Billing Unit", required: true, desc: "Package size and billing unit of measure (e.g., per 0.1 mL, per 15 mg)." },
    { name: "Strength / Dose", required: false, desc: "Strength per package used to validate unit conversion." },
    { name: "Active", required: false, desc: "Whether the drug is active on the formulary." },
  ],
};

// ── New Converge inputs (de-identified; optional per review). ──
const CLAIMS_EXTRACT: IntakeFile = {
  key: "claims_extract",
  title: "Claims Extract (de-identified)",
  desc: "Preferred claims input. One row per adjudicated claim line with denial and payment detail. Keep it de-identified — use an internal claim reference number, no patient PHI.",
  accepts: "CSV",
  required: true,
  handler: "claims_extract",
  countKey: "claims_extract",
  spec: [
    { name: "Claim Number", required: true, desc: "De-identified claim control number (used to request specific claims later; no PHI)." },
    { name: "Line Control Number", required: false, desc: "De-identified line control number (837↔835 line match)." },
    { name: "Service Date", required: false, desc: "Date of service." },
    { name: "HCPCS/CPT", required: true, desc: "Procedure code on the line." },
    { name: "Modifier 1/2/3/4", required: false, desc: "Line modifiers as billed on the 837." },
    { name: "Revenue Code", required: false, desc: "UB-04 revenue code." },
    { name: "Units", required: false, desc: "Billed units of service." },
    { name: "Diagnosis", required: false, desc: "Principal diagnosis / pointed diagnosis code." },
    { name: "Place of Service", required: false, desc: "POS code (drives PBD / telehealth checks)." },
    { name: "Billed Amount", required: true, desc: "Submitted/billed charge for the line (835)." },
    { name: "Allowed Amount", required: false, desc: "Payer-allowed amount (drives net collection yield)." },
    { name: "Paid Amount", required: true, desc: "Amount the payer paid (835)." },
    { name: "Contractual Adjustment", required: false, desc: "Contractual write-off (CO group)." },
    { name: "Patient Responsibility", required: false, desc: "Patient responsibility (PR group)." },
    { name: "Denial Code (CARC)", required: false, desc: "Claim Adjustment Reason Code for denied/adjusted lines." },
    { name: "RARC", required: false, desc: "Remittance Advice Remark Code, if present." },
    { name: "CAS Group", required: false, desc: "Adjustment group code (CO / PR / OA / PI / CR)." },
    { name: "Payer", required: false, desc: "Payer / plan name." },
  ],
};

const ITEM_MASTER: IntakeFile = {
  key: "item_master",
  title: "Item Master",
  desc: "The hospital item master. Used to catch device, C-code, and revenue-code setup errors between the item master and the chargemaster.",
  accepts: "CSV",
  required: true,
  handler: "item_master",
  countKey: "item_master",
  spec: [
    { name: "Item Number", required: true, desc: "Item master item/material number." },
    { name: "Description", required: false, desc: "Item description." },
    { name: "HCPCS/CPT", required: false, desc: "Billing code for the item, if any." },
    { name: "Revenue Code", required: false, desc: "Revenue code set on the item." },
    { name: "C-Code", required: false, desc: "Device C-code, if the item is a device/implant." },
    { name: "Is Device", required: false, desc: "Device/implant flag (Y/N)." },
    { name: "Charge Code", required: false, desc: "The chargemaster charge code this item links to." },
    { name: "Cost Center", required: false, desc: "Cost center / department on the item." },
    { name: "UOM", required: false, desc: "Unit of measure / billing unit (drug & supply checks)." },
    { name: "Active", required: false, desc: "Whether the item is active." },
  ],
};

const GL_DEPARTMENTS: IntakeFile = {
  key: "gl",
  title: "GL / Department List",
  desc: "From Finance: GL numbers mapped to department names (and the charge-code prefix that routes a charge to its department). Used to roll findings up by department.",
  accepts: "CSV",
  required: true,
  handler: "gl",
  countKey: "gl",
  spec: [
    { name: "GL Number", required: true, desc: "General-ledger account number." },
    { name: "Department", required: true, desc: "Department name for the GL account." },
    { name: "Charge Prefix", required: false, desc: "Charge numbers in this department begin with this prefix (e.g. radiology = 1234)." },
    { name: "Cost Center", required: false, desc: "Cost-center code, if distinct from the GL number." },
  ],
};

const CORE_FILES: IntakeFile[] = [CDM, RU, FORMULARY, CLAIMS_EXTRACT, ITEM_MASTER, GL_DEPARTMENTS];

// Facility type is fixed to short-term acute care; the argument is kept for
// call-site compatibility but no longer changes the file list.
export function intakeFilesForFacility(_ft?: FacilityType): IntakeFile[] {
  return CORE_FILES;
}
