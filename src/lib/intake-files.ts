import type { FacilityType } from "./rule-catalog";

// ChargeGuard supports short-term acute care hospitals. Every review needs the
// same three core files below; there is no per-facility file matrix anymore.
//
// handler: which importer parses the file into the database.
// spec: the column contract for the file, surfaced in the UI as a downloadable
// template / spec so clients send the right shape the first time.

export type IntakeHandler = "cdm" | "ru" | "formulary" | null;

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
  countKey?: "cdm" | "ru" | "formulary";
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

const CORE_FILES: IntakeFile[] = [CDM, RU, FORMULARY];

// Facility type is fixed to short-term acute care; the argument is kept for
// call-site compatibility but no longer changes the file list.
export function intakeFilesForFacility(_ft?: FacilityType): IntakeFile[] {
  return CORE_FILES;
}
