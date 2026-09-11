import type { FacilityType } from "./rule-catalog";

// Which intake files a review needs depends on the facility type, because the
// payment system differs (OPPS line-item APC vs IPPS MS-DRG vs SNF PDPM). This
// manifest drives the Imports tiles and the Review Imports status table.
//
// Sourced from CMS payment-system guidance (OPPS/IPPS/SNF PPS, SNF Consolidated
// Billing, UB-04). See chargeguard workflow memory for the full matrix.
//
// handler: which existing importer parses the file into the database. null =
// no automated parser yet, so the tile is a checklist item the client provides
// to the reviewer (still shown so the required-file list is correct per facility).

export type IntakeHandler = "cdm" | "ru" | "formulary" | "claims" | null;

export interface IntakeFile {
  key: string;
  title: string;
  desc: string;
  accepts: string;
  required: boolean;
  handler: IntakeHandler;
  // which count field reflects how many rows were imported (for handled files)
  countKey?: "cdm" | "ru" | "formulary" | "claims";
}

const CDM: IntakeFile = { key: "cdm", title: "Charge Master (CDM)", desc: "Your current chargemaster file. Needs charge code, description, HCPCS/CPT, revenue code, and price columns.", accepts: "Excel (.xlsx) or CSV", required: true, handler: "cdm", countKey: "cdm" };
const RU: IntakeFile = { key: "ru", title: "Revenue & Usage", desc: "Revenue and usage by charge code (annual units, gross charges, payer mix). Drives materiality and payer-impact ranking.", accepts: "Excel (.xlsx) or CSV", required: true, handler: "ru", countKey: "ru" };
const FORMULARY: IntakeFile = { key: "formulary", title: "Formulary", desc: "Pharmacy formulary with NDC and package units. Needed to validate drug billing units and NDC-to-HCPCS mapping.", accepts: "Excel (.xlsx) or CSV", required: true, handler: "formulary", countKey: "formulary" };
const COST_REPORT = (required: boolean): IntakeFile => ({ key: "cost_report", title: "Medicare Cost Report / CCR", desc: "Cost-to-charge ratios by department (from the Medicare cost report). Used for cost translation and outlier context.", accepts: "Excel (.xlsx), CSV, or PDF", required, handler: null });

// 837 claims tile adapts its wording/requirement by facility type.
const claims = (title: string, desc: string, required: boolean): IntakeFile => ({ key: "claims", title, desc, accepts: "EDI (.dat / .txt / .837)", required, handler: "claims", countKey: "claims" });

const MDS: IntakeFile = { key: "mds", title: "MDS / PDPM Assessment", desc: "MDS assessment / PDPM HIPPS data. Needed to validate PDPM classification and therapy delivery.", accepts: "Excel (.xlsx), CSV, or extract", required: true, handler: null };

export function intakeFilesForFacility(ft: FacilityType): IntakeFile[] {
  switch (ft) {
    case "inpatient":
      return [
        CDM, RU, FORMULARY,
        claims("Inpatient Claims / MS-DRG Case-Mix", "Inpatient claim or case-mix extract (ICD-10-CM/PCS, MS-DRG, discharge status, total charges, LOS). Needed for charge-capture and outlier context.", true),
        COST_REPORT(true),
      ];
    case "snf":
      return [
        CDM, RU, FORMULARY,
        MDS,
        claims("837 SNF Claims (21X)", "SNF institutional claims. Helps detect Consolidated Billing unbundling and Part B billing errors.", false),
        COST_REPORT(false),
      ];
    case "short_term_acute":
      return [
        CDM, RU, FORMULARY,
        claims("837 Claims — outpatient & inpatient", "Institutional claims for both settings. Confirms how the CDM actually bills.", false),
        COST_REPORT(false),
      ];
    case "opps_outpatient":
    default:
      return [
        CDM, RU, FORMULARY,
        claims("837 Outpatient Claims", "Outpatient institutional claims (revenue code, HCPCS + modifiers, units). Confirms how the CDM actually bills.", false),
        COST_REPORT(false),
      ];
  }
}
