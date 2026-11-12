// ─── CONVERGE setup questionnaire (Phase A) ──────────────────
// The facility facts no data file contains. Each fact gates the rules that can't
// be priced or even correctly identified without it (CONVERGE guide §2.4 / §5.4):
// a missing fact BLOCKS its rules rather than producing a wrong number. Facts are
// stored on audits.metadata.setup_facts.

export type FactType = "select" | "boolean" | "text";

export interface SetupFact {
  id: string;
  label: string;
  type: FactType;
  options?: { value: string; label: string }[];
  help: string;
  gates: string;       // what this fact unlocks (shown in the UI + scorecard)
  required: boolean;   // required facts block their rules until answered
}

export const SETUP_FACTS: SetupFact[] = [
  { id: "status_340b", label: "340B status", type: "select", required: true,
    options: [{ value: "none", label: "Not a 340B entity" }, { value: "340b", label: "340B covered entity" }, { value: "unknown", label: "Unknown" }],
    help: "Determines the drug pricing differential — can swing pharmacy findings by seven figures.",
    gates: "340B drug modifiers (TB/JG) and pharmacy pricing" },
  { id: "mac_locality", label: "MAC / locality", type: "text", required: true,
    help: "Your Medicare Administrative Contractor and locality drive the fee schedule and coverage. The wrong contractor = wrong rules.",
    gates: "Fee-schedule pricing, coverage (LCD/NCD), SI=A rates" },
  { id: "clia_certificate", label: "CLIA certificate type", type: "select", required: true,
    options: [{ value: "waiver", label: "Certificate of Waiver" }, { value: "ppmp", label: "PPMP" }, { value: "compliance", label: "Compliance" }, { value: "accreditation", label: "Accreditation" }, { value: "none", label: "None / unknown" }],
    help: "Governs which waived-test (QW) billing is permissible at this site.",
    gates: "Lab QW waived-test modifier rules" },
  { id: "single_multi_dose", label: "Single- vs multi-dose default", type: "select", required: false,
    options: [{ value: "single", label: "Mostly single-dose" }, { value: "multi", label: "Mostly multi-dose" }, { value: "mixed", label: "Mixed / per-drug" }],
    help: "Drives JW/JZ drug-waste modifiers and billing-unit logic.",
    gates: "Drug waste (JW/JZ) and billing-unit checks" },
  { id: "invoice_cost_products", label: "Invoice-cost / MAC-priced supplies?", type: "boolean", required: false,
    help: "MAC-priced supplies need actual invoice cost attached — a claim never reveals this requirement.",
    gates: "Invoice-cost supply & skin-substitute pricing" },
  { id: "cost_center_routing", label: "Cost-center / rev-code routing confirmed?", type: "boolean", required: false,
    help: "Dual-assigned items (skin substitutes, IOLs) route by the facility's own cost-center setup.",
    gates: "Dual-assignment rev-code validation" },
  { id: "pbd_sites", label: "Off-campus provider-based departments (PBD)?", type: "boolean", required: false,
    help: "Off-campus PBD lines require PO/PN/ER location modifiers on every line from that location.",
    gates: "PBD location modifiers (PO/PN/ER)" },
  { id: "ct_nema_compliant", label: "CT scanners NEMA XR-29 compliant?", type: "select", required: false,
    options: [{ value: "yes", label: "Yes — all compliant" }, { value: "no", label: "No — some non-compliant" }, { value: "na", label: "No CT / N/A" }],
    help: "A non-compliant scanner requires the CT modifier (payment reduction).",
    gates: "CT modifier + FX/FY imaging modifiers" },
  { id: "therapy_disciplines", label: "Therapy disciplines billed", type: "text", required: false,
    help: "PT / OT / SLP presence drives GP/GO/GN discipline modifiers and rev-code fences (042X/043X/044X).",
    gates: "Therapy discipline modifiers (GP/GO/GN)" },
];

export type SetupFacts = Record<string, string | boolean | null>;

/** Required facts that haven't been answered yet (these block their rules). */
export function missingRequiredFacts(facts: SetupFacts | null | undefined): SetupFact[] {
  const f = facts || {};
  return SETUP_FACTS.filter((d) => d.required).filter((d) => {
    const v = f[d.id];
    return v === undefined || v === null || v === "" || v === "unknown";
  });
}
