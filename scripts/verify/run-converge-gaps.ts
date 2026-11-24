/* Verifies the November 2026 Converge batch:
 *   CC-10 … CC-13 charge-capture rules (fire on planted defects, stay quiet on clean claims)
 *   CC-2 / CC-3 / CC-7 companion checks
 *   PHI guardrail on the claims extract (remove / transform / keep)
 *   Findings tab bucketing for the new output tabs
 */
import { runProcedureFollowOnRules, runAdminFamilyRules, runPayerSpecificRules, runEdDxCompanionRules, runChargeCaptureBatch2Rules, type ClaimRow } from "@/lib/converge-rules";
import { parseClaimsExtract } from "@/lib/converge-inputs-parser";
import { isPhiHeader, looksLikeIdentifier } from "@/lib/phi-guard";
import { bucketForCategory, BUCKET_ORDER } from "@/lib/finding-buckets";
import { TAB_REASONING } from "@/lib/tab-reasoning";
import { RULE_CATALOG } from "@/lib/rule-catalog";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, got?: any) => { cond ? (pass++, console.log(`  PASS  ${name}`)) : (fail++, console.log(`  FAIL  ${name}${got !== undefined ? "  got=" + JSON.stringify(got) : ""}`)); };

const cdmCodes = ["32555", "88305", "45380", "36556", "76937", "25600", "J9035", "96365", "96413", "J1885", "99291", "G0390", "G0168", "12001", "90686", "90471", "99284", "99285", "93005", "70460", "Q9967", "P9016", "36430", "47562", "J0696"];
const cdm = cdmCodes.map((c) => ({ id: "L_" + c, hcpcs_cpt_code: c, gross_charge: 100, charge_description: c, procedure_number: c }));
const line = (claim: string, hcpcs: string, o: Partial<ClaimRow> = {}): ClaimRow => ({ claim_id: claim, hcpcs, rev_code: null, units: 1, billed_amount: 100, allowed_amount: null, paid_amount: null, denial_code: null, payer: null, dx_code: null, ...o });
const ids = (rs: { rule_id: string }[]) => rs.map((r) => r.rule_id);

console.log("\n(1) CC-10 procedure follow-on (expected rate)");
{
  const bad: ClaimRow[] = []; for (let i = 0; i < 6; i++) bad.push(line("T" + i, "32555")); bad.push(line("T0", "89051"));   // 1 of 6 has a fluid study
  const good: ClaimRow[] = []; for (let i = 0; i < 6; i++) { good.push(line("G" + i, "32555")); good.push(line("G" + i, "89051")); }
  const few: ClaimRow[] = [line("F1", "32555"), line("F2", "32555")];
  const r = runProcedureFollowOnRules(cdm, bad);
  check("CC10.fluid fires at 17% follow-on rate", ids(r).includes("CC10.fluid"), ids(r));
  check("CC10.fluid has no dollar headline", r.every((x) => x.financial_impact === undefined));
  check("CC10.fluid attaches to the trigger's CDM line", r[0]?.charge_item_id === "L_32555", r[0]?.charge_item_id);
  check("CC10.fluid quiet at 100% rate", !ids(runProcedureFollowOnRules(cdm, good)).includes("CC10.fluid"));
  check("CC10 quiet below the minimum claim count", runProcedureFollowOnRules(cdm, few).length === 0);
  const path: ClaimRow[] = []; for (let i = 0; i < 5; i++) path.push(line("P" + i, "45380"));
  check("CC10.path fires: biopsies with no pathology", ids(runProcedureFollowOnRules(cdm, path)).includes("CC10.path"));
  const us: ClaimRow[] = []; for (let i = 0; i < 5; i++) us.push(line("U" + i, "36556"));
  check("CC10.usguide fires: central lines with no 76937", ids(runProcedureFollowOnRules(cdm, us)).includes("CC10.usguide"));
  const fx: ClaimRow[] = []; for (let i = 0; i < 5; i++) fx.push(line("X" + i, "25600"));
  check("CC10.cast fires: fracture care with no cast/splint", ids(runProcedureFollowOnRules(cdm, fx)).includes("CC10.cast"));
  const fxOk: ClaimRow[] = []; for (let i = 0; i < 5; i++) { fxOk.push(line("Y" + i, "25600")); fxOk.push(line("Y" + i, "Q4010")); }
  check("CC10.cast quiet when Q-code supply present", !ids(runProcedureFollowOnRules(cdm, fxOk)).includes("CC10.cast"));
}

console.log("\n(2) CC-11 administration family");
{
  const r1 = runAdminFamilyRules(cdm, [line("A1", "J9035"), line("A1", "96365")]);
  check("chemo drug + non-chemo admin fires", ids(r1).includes("CC11.chemo_drug_nonchemo_admin"), ids(r1));
  const r2 = runAdminFamilyRules(cdm, [line("A2", "J9035"), line("A2", "96413")]);
  check("chemo drug + chemo admin is clean", r2.length === 0, ids(r2));
  const r3 = runAdminFamilyRules(cdm, [line("A3", "J0696"), line("A3", "96413")]);
  check("chemo admin + only non-chemo drug fires", ids(r3).includes("CC11.chemo_admin_no_chemo_drug"), ids(r3));
  const r4 = runAdminFamilyRules(cdm, [line("A4", "J1885"), line("A4", "96365")]);
  check("injection-only drug + infusion admin fires", ids(r4).includes("CC11.inj_drug_infusion_admin"), ids(r4));
  const r5 = runAdminFamilyRules(cdm, [line("A5", "J1885"), line("A5", "96372")]);
  check("injection-only drug + 96372 is clean", r5.length === 0, ids(r5));
}

console.log("\n(3) CC-12 payer-specific codes");
{
  const r1 = runPayerSpecificRules(cdm, [line("M1", "99291", { rev_code: "0681", payer: "Medicare Part A" })]);
  check("trauma 068x + 99291, no G0390 (Medicare) fires", ids(r1).includes("CC12.trauma_no_g0390"), ids(r1));
  const r1b = runPayerSpecificRules(cdm, [line("M1b", "99291", { rev_code: "681", payer: "Medicare" })]);
  check("3-digit revenue code 681 reads as 068x", ids(r1b).includes("CC12.trauma_no_g0390"), ids(r1b));
  const r2 = runPayerSpecificRules(cdm, [line("M2", "99291", { rev_code: "0681", payer: "Medicare" }), line("M2", "G0390", { rev_code: "0681", payer: "Medicare" })]);
  check("trauma + 99291 + G0390 is clean", r2.length === 0, ids(r2));
  const r3 = runPayerSpecificRules(cdm, [line("M3", "99291", { rev_code: "0681", payer: "Blue Cross" })]);
  check("commercial payer does not get the G0390 prompt", !ids(r3).includes("CC12.trauma_no_g0390"), ids(r3));
  const r4 = runPayerSpecificRules(cdm, [line("M4", "G0390", { rev_code: "0450", payer: "Medicare" })]);
  check("G0390 without 068x / 99291 fires", ids(r4).includes("CC12.g0390_unsupported"), ids(r4));
  const r5 = runPayerSpecificRules(cdm, [line("M5", "G0168", { payer: "Aetna" })]);
  check("G0168 to a non-Medicare payer fires", ids(r5).includes("CC12.g0168_nonmedicare"), ids(r5));
  const r6 = runPayerSpecificRules(cdm, [line("M6", "G0168", { payer: "Medicare" }), line("M6", "12001", { payer: "Medicare" })]);
  check("G0168 with a simple repair fires", ids(r6).includes("CC12.g0168_with_repair") && !ids(r6).includes("CC12.g0168_nonmedicare"), ids(r6));
  const r7 = runPayerSpecificRules(cdm, [line("M7", "90686", { payer: "Medicare" }), line("M7", "90471", { payer: "Medicare" })]);
  check("Medicare flu vaccine with 90471 fires", ids(r7).includes("CC12.vaccine_gcode"), ids(r7));
  const r8 = runPayerSpecificRules(cdm, [line("M8", "90686", { payer: "Cigna" }), line("M8", "90471", { payer: "Cigna" })]);
  check("commercial flu vaccine with 90471 is clean", r8.length === 0, ids(r8));
}

console.log("\n(4) CC-13 ED diagnosis companions (expected rate)");
{
  const cp: ClaimRow[] = []; for (let i = 0; i < 6; i++) cp.push(line("E" + i, "99284", { dx_code: i % 2 ? "R07.9" : "R079" })); cp.push(line("E0", "93005"));
  const r = runEdDxCompanionRules(cdm, cp);
  check("CC13.chestpain fires at 17% ECG rate (dotted and undotted dx)", ids(r).includes("CC13.chestpain"), ids(r));
  const ok: ClaimRow[] = []; for (let i = 0; i < 6; i++) { ok.push(line("K" + i, "99285", { dx_code: "R07.9" })); ok.push(line("K" + i, "93005")); }
  check("CC13.chestpain quiet when every visit has an ECG", runEdDxCompanionRules(cdm, ok).length === 0);
  const lvl: ClaimRow[] = []; for (let i = 0; i < 6; i++) lvl.push(line("V" + i, "99282", { dx_code: "R07.9" }));
  check("CC13 ignores ED levels 1 and 2", runEdDxCompanionRules(cdm, lvl).length === 0);
  const ur: ClaimRow[] = []; for (let i = 0; i < 5; i++) ur.push(line("N" + i, "99284", { dx_code: "N39.0" }));
  check("CC13.urinary fires: UTI visits with no urinalysis", ids(runEdDxCompanionRules(cdm, ur)).includes("CC13.urinary"));
}

console.log("\n(5) CC-2 / CC-3 / CC-7 companions");
{
  const r1 = runChargeCaptureBatch2Rules(cdm, [line("B1", "70460", { rev_code: "0350" })]);
  check("contrast CT with no agent fires", ids(r1).includes("CC2.img_contrast_no_agent"), ids(r1));
  const r2 = runChargeCaptureBatch2Rules(cdm, [line("B2", "70460", { rev_code: "0350" }), line("B2", "Q9967", { rev_code: "0636" })]);
  check("contrast CT with agent is clean", !ids(r2).includes("CC2.img_contrast_no_agent"), ids(r2));
  const r3 = runChargeCaptureBatch2Rules(cdm, [line("B3", "P9016", { rev_code: "0390" })]);
  check("blood product with no transfusion fires", ids(r3).includes("CC2.blood_product_no_admin"), ids(r3));
  const r4 = runChargeCaptureBatch2Rules(cdm, [line("B4", "36430", { rev_code: "0391" })]);
  check("transfusion with no product fires", ids(r4).includes("CC2.blood_admin_no_product"), ids(r4));
  const r5 = runChargeCaptureBatch2Rules(cdm, [line("B5", "47562", { rev_code: "360" })]);
  check("OR case with no anesthesia / recovery fires both", ids(r5).includes("CC2.or_no_anesthesia") && ids(r5).includes("CC2.or_no_recovery"), ids(r5));
  const r6 = runChargeCaptureBatch2Rules(cdm, [line("B6", "47562", { rev_code: "0360" }), line("B6", "", { rev_code: "0370" }), line("B6", "", { rev_code: "0710" })]);
  check("OR case with 037x and 071x is clean", !ids(r6).some((x) => x.startsWith("CC2.or_")), ids(r6));
}

console.log("\n(6) PHI guardrail");
{
  for (const h of ["Patient Name", "Patient DOB", "Date of Birth", "SSN", "MRN", "Member ID", "Subscriber ID", "Patient Address", "Zip Code", "Patient Account Number", "Phone", "Email"])
    check(`removes "${h}"`, isPhiHeader(h));
  for (const h of ["Claim Number", "CPT Number", "HCPCS/CPT", "Patient Responsibility", "Patient Control Number", "Service Date", "Payer", "Plan Name", "Revenue Code", "Denial Code (CARC)", "Line Control Number", "Paid Amount", "Receipt Number"])
    check(`keeps "${h}"`, !isPhiHeader(h));
  check("SSN value detected", looksLikeIdentifier("123-45-6789"));
  check("MBI value detected", looksLikeIdentifier("1EG4-TE5-MK73"));
  check("ordinary claim number not flagged", !looksLikeIdentifier("CLM-000123") && !looksLikeIdentifier("20261100456"));

  const csv = [
    "Patient Name,Date of Birth,Claim Number,HCPCS/CPT,Service Date,Billed Amount,Paid Amount,Patient Responsibility,Payer,Member ID",
    "Jane Doe,01/02/1950,123-45-6789,99284,11/03/2026,540,200,35,Medicare,1EG4TE5MK73",
    "Jane Doe,01/02/1950,123-45-6789,93005,11/03/2026,120,40,0,Medicare,1EG4TE5MK73",
    "John Roe,05/06/1961,CLM-77,99283,11/04/2026,300,100,20,Aetna,W123",
  ].join("\n");
  const { rows, meta } = parseClaimsExtract(csv);
  const blob = JSON.stringify(rows);
  check("3 rows parsed", rows.length === 3, rows.length);
  check("no patient name, DOB, SSN or member ID in the parsed output", !/Jane|Doe|Roe|1950|1961|123-45-6789|1EG4TE5MK73|W123/.test(blob), blob.slice(0, 200));
  check("service date is the service date, not the birth date", rows[0].service_date === "11/03/2026", rows[0].service_date);
  check("SSN-shaped claim number replaced by a stable surrogate", rows[0].claim_id === rows[1].claim_id && /^REF-\d{6}$/.test(String(rows[0].claim_id)), rows[0].claim_id);
  check("ordinary claim number kept", rows[2].claim_id === "CLM-77", rows[2].claim_id);
  check("patient responsibility kept as an amount", rows[0].patient_resp === 35, rows[0].patient_resp);
  check("report lists the removed columns", meta.phi?.removedColumns.length === 3 && meta.phi?.transformedValues === 2, meta.phi);
  const noPr = parseClaimsExtract("Claim Number,Procedure Code,Billed Amount,Paid Amount\nC1,99283,100,50");
  check("procedure code is not mis-read as patient responsibility", noPr.rows[0].patient_resp === null && noPr.rows[0].hcpcs === "99283", noPr.rows[0]);
}

console.log("\n(7) Findings tabs and catalog");
{
  const exp: [string, string][] = [
    ["Charge Capture — Missing Companion", "charge_capture"], ["Charge Capture — Procedure Follow-On (Rate)", "charge_capture"], ["Charge Capture — Payer-Specific Codes", "charge_capture"],
    ["Denial Analysis (Claims)", "claims"], ["Pricing vs Paid (Claims)", "claims"], ["NCCI Unbundling (PTP)", "claims"], ["MUE Unit Cap", "claims"], ["Modifier 25 Co-Billing (Claims)", "claims"],
    ["Item Master Reconciliation", "item_master"], ["Pharmacy UOM Mismatch", "formulary"], ["RVU / Low Volume", "rvu"], ["Peer Pricing (Named Competitors)", "peer"],
    ["Retired HCPCS", "cdm"], ["Medicare Markup (Underpriced)", "cdm"], ["Modifier Validity", "cdm"], ["Duplicate", "cdm"],
  ];
  for (const [cat, b] of exp) check(`"${cat}" → ${b}`, bucketForCategory(cat) === b, bucketForCategory(cat));
  check("every tab has rules-and-reasoning content", BUCKET_ORDER.every((b) => TAB_REASONING[b]?.rules.length > 0));
  const catalogIds = new Set(RULE_CATALOG.flatMap((g) => g.items.flatMap((i) => i.ids)));
  const need = ["CC10.fluid", "CC10.path", "CC10.usguide", "CC10.cast", "CC11.chemo_drug_nonchemo_admin", "CC11.chemo_admin_no_chemo_drug", "CC11.inj_drug_infusion_admin", "CC12.trauma_no_g0390", "CC12.g0390_unsupported", "CC12.g0168_nonmedicare", "CC12.g0168_with_repair", "CC12.vaccine_gcode", "CC13.chestpain", "CC13.resp", "CC13.urinary", "CC2.img_contrast_no_agent", "CC2.img_agent_no_contrast_exam", "CC2.blood_product_no_admin", "CC2.blood_admin_no_product", "CC2.or_no_anesthesia", "CC2.or_no_recovery"];
  const missing = need.filter((i) => !catalogIds.has(i));
  check("every new rule id has a catalog toggle", missing.length === 0, missing);
}

console.log("\n--------------------------------------------------------");
console.log(`PASS ${pass}   FAIL ${fail}`);
process.exit(fail ? 1 : 0);
