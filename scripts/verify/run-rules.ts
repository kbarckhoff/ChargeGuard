/* Per-rule verification harness.
 * Imports the REAL rule modules + REAL bundled CMS reference (the same code the
 * scan runs; getReference falls back to the bundled JSON when no DB is loaded),
 * feeds planted-defect rows, and asserts each expected rule_id fires.
 * Run: compiled to CJS, then `node -r _alias.js run-rules.js`.
 */
import { runRules } from "@/lib/structural-rules";
import {
  runReferenceRules, runDeviceCrosswalkRules, runCodingUpdateRules, runPriceTransparencyRules,
  runMultiplierRules, runFormularyRules, runBenchmarkRules, runModifierRules, runInternalPricingRules, runRvuRules,
} from "@/lib/cdm-reference-rules";
import { runClaimsRules } from "@/lib/claims-rules";
import { runChargeCapturePairRules, runChargeCaptureBatch2Rules, runDenialRules, runPricingVsPaidRules, runEdDxCompanionRules } from "@/lib/converge-rules";
import { runItemMasterRules } from "@/lib/item-master-rules";
import { runPtpUnbundlingRules, runMueRules } from "@/lib/ncci-rules";
import { runPeerCompetitorRules } from "@/lib/peer-rules";

type Any = any;
let _id = 0;
const nid = (p: string) => `${p}_${++_id}`;
// CDM line factory with sane defaults.
function cdm(o: Partial<Any>): Any {
  return {
    id: o.id || nid("cdm"), procedure_number: o.procedure_number || o.id || nid("P"),
    charge_description: o.charge_description ?? "Service", hcpcs_cpt_code: o.hcpcs_cpt_code ?? "",
    revenue_code: o.revenue_code ?? "0510", gross_charge: o.gross_charge ?? "100",
    department: o.department ?? "", modifier_1: o.modifier_1 ?? "", modifier_2: o.modifier_2 ?? "",
    modifier_3: o.modifier_3 ?? "", is_active: o.is_active ?? true, ndc_code: o.ndc_code ?? "", raw_data: o.raw_data ?? {},
  };
}

// ── Build the CDM (one planted line per structural/reference rule) ──
const items: Any[] = [];
const push = (o: Partial<Any>) => { const it = cdm(o); items.push(it); return it; };

// Structural
push({ id: "S2", charge_description: "Lab test", hcpcs_cpt_code: "85025", revenue_code: "" });                 // S.2 no rev
push({ id: "S4", charge_description: "Lab test", hcpcs_cpt_code: "", revenue_code: "0300" });                  // S.4 rev requires hcpcs
push({ id: "S3", charge_description: "misc", hcpcs_cpt_code: "", revenue_code: "" });                          // S.3 vague (+S.2)
push({ id: "Z65", charge_description: "Therapy session", hcpcs_cpt_code: "97110", revenue_code: "0420", gross_charge: "0" }); // 6.5 zero price
push({ id: "DME", charge_description: "Standard wheelchair rental", hcpcs_cpt_code: "K0001", revenue_code: "0450" });        // 1.7 DME
push({ id: "BLD", charge_description: "Packed red blood cells leukoreduced", hcpcs_cpt_code: "P9016", revenue_code: "0300" }); // 1.8 blood under non-038/039 rev
push({ id: "IMP", charge_description: "Pacemaker dual chamber implant", hcpcs_cpt_code: "C1785", revenue_code: "0300" });     // 1.9 implant wrong rev
push({ id: "NB", charge_description: "Guest tray meal (non-covered)", hcpcs_cpt_code: "", revenue_code: "0990" });            // 2.1 non-billable
push({ id: "HM", charge_description: "Nerve block", hcpcs_cpt_code: "64450", revenue_code: "0360", modifier_1: "59" });       // 2.4 hardcoded mod
push({ id: "R1", charge_description: "XR ankle", hcpcs_cpt_code: "73610", revenue_code: "0320" });             // R1 radiology missing laterality
push({ id: "A1", charge_description: "Debridement addl", hcpcs_cpt_code: "11001", revenue_code: "0360" });     // A1 add-on w/o primary (11000 absent)
push({ id: "L1p", charge_description: "Comprehensive metabolic panel", hcpcs_cpt_code: "80053", revenue_code: "0301" });      // L1 panel...
push({ id: "L1c", charge_description: "Glucose", hcpcs_cpt_code: "82947", revenue_code: "0301" });             // ...+component present
push({ id: "MM", charge_description: "ECG radiology range", hcpcs_cpt_code: "99213", revenue_code: "0320" });  // 1.3 rev/cpt mismatch (E/M under radiology rev)
push({ id: "D1", charge_description: "CT head", hcpcs_cpt_code: "70450", revenue_code: "0350", gross_charge: "500" });        // dupe pair A
push({ id: "D2", charge_description: "CT head", hcpcs_cpt_code: "70450", revenue_code: "0350", gross_charge: "500" });        // 1.11 duplicate
push({ id: "V1", charge_description: "MRI brain", hcpcs_cpt_code: "70551", revenue_code: "0610", gross_charge: "100" });      // 3.2 price variance A
push({ id: "V2", charge_description: "MRI brain", hcpcs_cpt_code: "70551", revenue_code: "0610", gross_charge: "900" });      // 3.2 variance (9x)
push({ id: "UN", charge_description: "Unlisted procedure", hcpcs_cpt_code: "17999", revenue_code: "0360" });   // 3.3 unlisted

// Reference-driven
push({ id: "RET", charge_description: "Epidermal biopsy (retired)", hcpcs_cpt_code: "11100", revenue_code: "0360" });        // 12 retired
push({ id: "SIA", charge_description: "Screening mammography CAD", hcpcs_cpt_code: "77065", revenue_code: "0320", gross_charge: "50" }); // SIA below fee (fee 123.91)
push({ id: "VAC", charge_description: "Flu vaccine quad", hcpcs_cpt_code: "90686", revenue_code: "0636" });    // 2b vaccine missing admin
push({ id: "SAD", charge_description: "Oral self-admin drug", hcpcs_cpt_code: "", revenue_code: "0637" });     // 637 self-admin
push({ id: "BIL", charge_description: "Bilateral knee injection", hcpcs_cpt_code: "20610", revenue_code: "0360", modifier_1: "50", gross_charge: "100" }); // 10 bilateral price / 10.B
push({ id: "MR1", charge_description: "Wound supply", hcpcs_cpt_code: "A4550", revenue_code: "0270", gross_charge: "20" });   // M multi-rev A (family 027)
push({ id: "MR2", charge_description: "Wound supply", hcpcs_cpt_code: "A4550", revenue_code: "0300", gross_charge: "20" });   // M multi-rev B (family 030 — distinct)

// Markup band (U / MK.high): non-E/M codes (clinic-visit E/M 99201-99215 is excluded by design).
push({ id: "MKlow", charge_description: "Tendon sheath injection", hcpcs_cpt_code: "20550", revenue_code: "0510", gross_charge: "1" });     // U underpriced vs MC (needs R&U units)
push({ id: "MKhi", charge_description: "Shoulder arthroscopy", hcpcs_cpt_code: "29826", revenue_code: "0360", gross_charge: "999999" });   // MK.high far above (>4.5x)

// usage (R&U) keyed by charge_code(procedure_number)
const usageByCode = new Map<string, Any>();
usageByCode.set("MKlow", { charge_code: "MKlow", units: 50, gross: 50, modifier: "" });
usageByCode.set("SAD", { charge_code: "SAD", units: 25, gross: 500, modifier: "" }); // 637 fires only on R&U-active lines
usageByCode.set("RVU0", { charge_code: "RVU0", units: 0, gross: 0, modifier: "" });
usageByCode.set("RVUlo", { charge_code: "RVUlo", units: 3, gross: 300, modifier: "" });
push({ id: "RVU0", charge_description: "Rare procedure", hcpcs_cpt_code: "27447", revenue_code: "0360", gross_charge: "5000" }); // RVU.0 zero volume
push({ id: "RVUlo", charge_description: "Low vol proc", hcpcs_cpt_code: "29881", revenue_code: "0360", gross_charge: "3000" });  // RVU.low

// Formulary (INF / NDC / UOM / PBU) — a J-code drug with ASP+dosage
push({ id: "DRGu", charge_description: "Rituximab inj", hcpcs_cpt_code: "J9312", revenue_code: "0636", gross_charge: "9000", ndc_code: "00004110001" });
const formularyByCode = new Map<string, Any>();
formularyByCode.set("DRGu", { charge_code: "DRGu", status: "inactive", ndc: "99999999999", drug_name: "Rituximab", pkg_amt: "500", pkg_unit: "MG" });
usageByCode.set("DRGu", { charge_code: "DRGu", units: 10, gross: 90000, modifier: "" });
// UOM mismatch: same drug but formulary package unit is VOLUME (mL) while the HCPCS
// billing unit is MASS (mg) — incompatible dimensions route to the UOM flag.
push({ id: "DRGv", charge_description: "Rituximab inj (UOM)", hcpcs_cpt_code: "J9312", revenue_code: "0636", gross_charge: "9000", ndc_code: "00004110002" });
formularyByCode.set("DRGv", { charge_code: "DRGv", status: "active", ndc: "00004110002", drug_name: "Rituximab", pkg_amt: "50", pkg_unit: "ML" });
usageByCode.set("DRGv", { charge_code: "DRGv", units: 10, gross: 90000, modifier: "" });

// L2: all components of Electrolyte panel (80051) present, panel absent
for (const c of ["82374", "82435", "84132", "84295"]) push({ id: "L2_" + c, charge_description: "Electrolyte comp " + c, hcpcs_cpt_code: c, revenue_code: "0301" });

// Device crosswalk (2c.F / 2c.R)
push({ id: "DEVF", charge_description: "Coronary stent placement", hcpcs_cpt_code: "92928", revenue_code: "0360" });  // 2c.F device proc no C-code
push({ id: "DEVR", charge_description: "Implantable device", hcpcs_cpt_code: "", revenue_code: "0278" });             // 2c.R rev278 no c-code

// Price transparency shoppable (PT.*) — give a known shoppable code unpriced
push({ id: "PT1", charge_description: "MRI lower extremity joint", hcpcs_cpt_code: "73721", revenue_code: "0610", gross_charge: "0" });

// ── 837 claim_lines (C25/C59/CNIC/CUNIT) ──
const claimLines: Any[] = [];
// C25: E/M w/ mod25 + a procedure same claim
claimLines.push({ claim_id: "CLA", rev_code: "0510", hcpcs: "99214", mod1: "25", mod2: null, mod3: null, mod4: null, units: 1, line_charge: 200, service_date: "2026-01-02", dx_primary: "Z00" });
claimLines.push({ claim_id: "CLA", rev_code: "0360", hcpcs: "20610", mod1: null, mod2: null, mod3: null, mod4: null, units: 1, line_charge: 100, service_date: "2026-01-02", dx_primary: "M17" });
// C59: unbundling modifier
claimLines.push({ claim_id: "CLB", rev_code: "0360", hcpcs: "20610", mod1: "59", mod2: null, mod3: null, mod4: null, units: 1, line_charge: 100, service_date: "2026-01-03", dx_primary: "M17" });
// CNIC: code billed not in CDM
claimLines.push({ claim_id: "CLC", rev_code: "0300", hcpcs: "84999", mod1: null, mod2: null, mod3: null, mod4: null, units: 1, line_charge: 40, service_date: "2026-01-04", dx_primary: "R79" });
// CUNIT: unit outlier (need >=5 lines for code, one far above median)
for (let i = 0; i < 6; i++) claimLines.push({ claim_id: "CU" + i, rev_code: "0636", hcpcs: "J9312", mod1: null, mod2: null, mod3: null, mod4: null, units: i === 5 ? 50 : 1, line_charge: 900, service_date: "2026-01-05", dx_primary: "C85" });

// ── Converge claims_extract (CC/CC2/DEN/PVP/NCCI.ptp) ──
const cx: Any[] = [];
const cxRow = (o: Partial<Any>): Any => ({ claim_id: o.claim_id || null, hcpcs: o.hcpcs ?? null, rev_code: o.rev_code ?? null, units: o.units ?? 1, mod1: o.mod1 ?? null, mod2: null, mod3: null, mod4: null, dx_code: o.dx_code ?? null, billed_amount: o.billed_amount ?? 100, allowed_amount: o.allowed_amount ?? null, paid_amount: o.paid_amount ?? 0, denial_code: o.denial_code ?? null, payer: o.payer ?? "PayerA" });
// CC.drug_no_admin: drug (J-code) on a claim with no admin; anchor must be in CDM
cx.push(cxRow({ claim_id: "X1", hcpcs: "J9312", rev_code: "0636", billed_amount: 9000 }));           // CC.drug_no_admin (J9312 in CDM)
// CC.admin_no_drug: admin code, no drug; anchor admin must be in CDM -> add 96365 to CDM
push({ id: "ADM", charge_description: "IV infusion initial", hcpcs_cpt_code: "96365", revenue_code: "0260" });
cx.push(cxRow({ claim_id: "X2", hcpcs: "96365", rev_code: "0260" }));                                  // CC.admin_no_drug
// CC13.chestpain: dx R07, no ECG; anchor is first code -> ensure that code in CDM
push({ id: "EDv", charge_description: "ED visit level 4", hcpcs_cpt_code: "99284", revenue_code: "0450" });
for (let i = 0; i < 5; i++) cx.push(cxRow({ claim_id: "X3" + i, hcpcs: "99284", rev_code: "0450", dx_code: "R07.9" }));                // CC13.chestpain
// DEN: denial code recurring
push({ id: "DENc", charge_description: "Drug admin", hcpcs_cpt_code: "96372", revenue_code: "0260" });
cx.push(cxRow({ claim_id: "X4", hcpcs: "96372", rev_code: "0260", billed_amount: 500, paid_amount: 0, denial_code: "197" }));
cx.push(cxRow({ claim_id: "X5", hcpcs: "96372", rev_code: "0260", billed_amount: 500, paid_amount: 0, denial_code: "197" }));
// PVP.low: CDM price far below avg allowed
push({ id: "PVPc", charge_description: "Echo complete", hcpcs_cpt_code: "93306", revenue_code: "0480", gross_charge: "50" });
cx.push(cxRow({ claim_id: "X6", hcpcs: "93306", rev_code: "0480", billed_amount: 50, allowed_amount: 400, paid_amount: 400 }));
cx.push(cxRow({ claim_id: "X7", hcpcs: "93306", rev_code: "0480", billed_amount: 50, allowed_amount: 400, paid_amount: 400 }));
// NCCI.ptp.0: col1 80053 + col2 82040 on same claim, no override; CDM has 82040? add it
push({ id: "PTP2", charge_description: "Albumin", hcpcs_cpt_code: "82040", revenue_code: "0301" });
cx.push(cxRow({ claim_id: "X8", hcpcs: "80053", rev_code: "0301" }));
cx.push(cxRow({ claim_id: "X8", hcpcs: "82040", rev_code: "0301" }));
// NCCI.mue: needs mue in reference (none in bundled) — exercise path anyway
cx.push(cxRow({ claim_id: "X9", hcpcs: "82040", rev_code: "0301", units: 99 }));

const ptpMap = new Map<string, string | null>([["80053|82040", "0"], ["82040|80053", "0"]]);

// ── item_master (IM.device / IM.rev) ──
const itemMaster: Any[] = [
  { item_number: "IMX1", description: "Drug-eluting stent", hcpcs: "92928", rev_code: "0278", c_code: "C1874", is_device: true, charge_code: "DEVF", is_active: true }, // IM.device (CDM line DEVF has no C-code/dev rev)
  { item_number: "IMX2", description: "Echo", hcpcs: "93306", rev_code: "0999", c_code: null, is_device: false, charge_code: "PVPc", is_active: true },                 // IM.rev (0999 vs CDM 0480)
];

// ── peer_prices (PC.low / PC.high) ──
// SI=S imaging (separately paid, not packaged) so the peer comparison applies.
push({ id: "PClow", charge_description: "MRI brain functional", hcpcs_cpt_code: "70555", revenue_code: "0610", gross_charge: "100" });    // below peers
push({ id: "PChi", charge_description: "MRI spine special", hcpcs_cpt_code: "72083", revenue_code: "0610", gross_charge: "99999" });      // above peers
const peerRows: Any[] = [
  { hcpcs: "70555", gross_charge: 2000, competitor: "Hosp A" }, { hcpcs: "70555", gross_charge: 2200, competitor: "Hosp B" },
  { hcpcs: "72083", gross_charge: 300, competitor: "Hosp A" }, { hcpcs: "72083", gross_charge: 320, competitor: "Hosp B" },
];

// ── RUN everything exactly as the scan route does ──
const all: Any[] = [
  ...runRules(items),
  ...runReferenceRules(items, usageByCode),
  ...runDeviceCrosswalkRules(items),
  ...runCodingUpdateRules(items, usageByCode),
  ...runPriceTransparencyRules(items),
  ...runMultiplierRules(items),
  ...runFormularyRules(items, formularyByCode, usageByCode),
  ...runModifierRules(items, usageByCode),
  ...runInternalPricingRules(items),
  ...runRvuRules(items, usageByCode, 10),
  ...runBenchmarkRules(items, null, new Set(formularyByCode.keys())),
  ...runClaimsRules(items, claimLines),
  ...runPeerCompetitorRules(items, peerRows, new Set(formularyByCode.keys())),
  ...runChargeCapturePairRules(items, cx),
  ...runChargeCaptureBatch2Rules(items, cx),
  ...runEdDxCompanionRules(items, cx),
  ...runDenialRules(items, cx),
  ...runPricingVsPaidRules(items, cx),
  ...runItemMasterRules(items, itemMaster),
  ...runPtpUnbundlingRules(items, cx, ptpMap),
  ...runMueRules(items, cx),
];

const fired = new Set(all.map((r) => r.rule_id));
const firedPrefix = (p: string) => [...fired].some((id) => id === p || id.startsWith(p + "."));

// Expected rule_ids (prefix match for families like DEN.*, NCCI.ptp.*)
const expect: { id: string; label: string; note?: string }[] = [
  { id: "S.2", label: "No revenue code" },
  { id: "S.4", label: "Rev requires HCPCS" },
  { id: "S.3", label: "Vague description" },
  { id: "6.5", label: "Zero price" },
  { id: "1.7", label: "DME rev code" },
  { id: "1.8", label: "Blood product rev" },
  { id: "1.9", label: "Implant rev code" },
  { id: "2.1", label: "Non-billable item" },
  { id: "2.4", label: "Hard-coded modifier" },
  { id: "R1", label: "Radiology missing laterality" },
  { id: "A1", label: "Add-on without primary" },
  { id: "L1", label: "Panel + components" },
  { id: "L2", label: "Panel missing, components present" },
  { id: "1.3", label: "Rev/CPT mismatch" },
  { id: "1.11", label: "Duplicate line" },
  { id: "3.2", label: "Price variance" },
  { id: "3.3", label: "Unlisted code" },
  { id: "12", label: "Retired code" },
  { id: "SIA", label: "SI=A below fee" },
  { id: "2b", label: "Vaccine missing admin" },
  { id: "637", label: "Self-admin drug (rev 637)" },
  { id: "10", label: "Bilateral pricing/laterality" },
  { id: "M", label: "Same code multiple rev codes" },
  { id: "U", label: "Underpriced vs Medicare" },
  { id: "MK.high", label: "Far above markup band" },
  { id: "RVU.0", label: "Zero volume" },
  { id: "RVU.low", label: "Low volume" },
  { id: "INF", label: "Inactive drug billed" },
  { id: "NDC", label: "NDC mismatch" },
  { id: "UOM", label: "UOM mismatch" },
  { id: "PBU", label: "Drug price vs ASP" },
  { id: "2c", label: "Device missing C-code" },
  { id: "PT", label: "Price transparency shoppable" },
  { id: "C25", label: "Modifier-25 co-bill (claims)" },
  { id: "C59", label: "Unbundling modifier (claims)" },
  { id: "CNIC", label: "Billed not in CDM (claims)" },
  { id: "CUNIT", label: "Unit outlier (claims)" },
  { id: "PC.low", label: "Below competitors" },
  { id: "PC.high", label: "Above competitors" },
  { id: "CC.drug_no_admin", label: "Drug w/o admin" },
  { id: "CC.admin_no_drug", label: "Admin w/o drug" },
  { id: "CC13.chestpain", label: "ED chest pain w/o ECG (dx rate)" },
  { id: "DEN", label: "Denial analysis" },
  { id: "PVP.low", label: "Pricing vs paid" },
  { id: "IM.device", label: "Item master device setup" },
  { id: "IM.rev", label: "Item master rev mismatch" },
  { id: "NCCI.ptp", label: "NCCI PTP unbundling" },
];
// Rules that are wired but cannot fire against the bundled reference (need DB/CMS
// data that is not shipped in the repo). Reported separately, not counted as fails.
const dataDependent: { id: string; label: string; why: string }[] = [
  { id: "NCCI.mue", label: "MUE unit cap", why: "bundled cms_reference has 0 codes with an MUE value; depends on the NCCI-MUE DB refresh" },
  { id: "BM.low/high", label: "CMS peer benchmark", why: "pricing-benchmark-data.json is an empty placeholder; depends on build-benchmark.mjs output" },
];

let pass = 0, fail = 0;
const fails: string[] = [];
console.log("\nRULE                              STATUS   id");
console.log("--------------------------------------------------------");
for (const e of expect) {
  const ok = firedPrefix(e.id);
  if (ok) pass++; else { fail++; fails.push(e.id); }
  console.log(`${e.label.padEnd(33)} ${ok ? "PASS  " : "FAIL  "}   ${e.id}`);
}
console.log("--------------------------------------------------------");
console.log(`PASS ${pass} / ${expect.length}   FAIL ${fail}`);
if (fails.length) console.log("FAILS:", fails.join(", "));
console.log("\nData-dependent (wired, cannot fire on bundled reference):");
for (const d of dataDependent) console.log(`  ${d.label} [${d.id}] — ${d.why}`);
console.log("\nAll fired rule_ids (" + fired.size + "):", [...fired].sort().join(", "));
