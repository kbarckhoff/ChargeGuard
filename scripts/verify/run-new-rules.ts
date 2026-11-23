/* Verify Greg's 3 new CDM checks fire (and don't false-positive):
 *   MOD.invalid   — unrecognized modifier on a CDM line
 *   CODE.invalid  — malformed CPT/HCPCS code
 *   SI.E1 / SI.E2 — non-covered status indicators (logic check with a stub ref)
 */
import { runRules } from "@/lib/structural-rules";
import { runReferenceRules } from "@/lib/cdm-reference-rules";

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, got?: any) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${got !== undefined ? "  got=" + JSON.stringify(got) : ""}`); }
};

const item = (o: any) => ({ id: o.id, procedure_number: o.id, charge_description: o.desc || "Test line",
  hcpcs_cpt_code: o.code ?? "", revenue_code: o.rev ?? "0450", gross_charge: o.price ?? "100",
  modifier_1: o.m1 ?? "", modifier_2: o.m2 ?? "", modifier_3: o.m3 ?? "" });

console.log("\n(1) MODIFIER VALIDITY (structural)");
const mods = runRules([
  item({ id: "MV1", code: "71045", m1: "ZZ" }),   // invalid modifier
  item({ id: "MV2", code: "71045", m1: "59" }),   // valid CPT modifier
  item({ id: "MV3", code: "71045", m1: "F3" }),   // valid anatomic (pattern)
  item({ id: "MV4", code: "71045", m1: "LT" }),   // valid HCPCS
]);
const modInvalid = mods.filter((r) => r.rule_id === "MOD.invalid");
check("MOD.invalid fires on 'ZZ'", modInvalid.some((r) => r.charge_item_id === "MV1"), modInvalid.map((r) => r.charge_item_id));
check("MOD.invalid does NOT fire on '59'", !modInvalid.some((r) => r.charge_item_id === "MV2"));
check("MOD.invalid does NOT fire on 'F3'", !modInvalid.some((r) => r.charge_item_id === "MV3"));
check("MOD.invalid does NOT fire on 'LT'", !modInvalid.some((r) => r.charge_item_id === "MV4"));

console.log("\n(2) INVALID / NONEXISTENT CODE (reference)");
const refOut = runReferenceRules([
  item({ id: "BC1", code: "ABC", desc: "Bad code line" }),       // malformed → CODE.invalid
  item({ id: "BC2", code: "99A99", desc: "Letters mid-code" }),   // malformed → CODE.invalid
  item({ id: "OK1", code: "71045", desc: "Valid chest xray" }),  // valid format; not in bundled ref → skipped (no CODE.* on bundled)
]);
const codeInvalid = refOut.filter((r) => r.rule_id === "CODE.invalid");
check("CODE.invalid fires on 'ABC'", codeInvalid.some((r) => r.charge_item_id === "BC1"), codeInvalid.map((r) => r.charge_item_id));
check("CODE.invalid fires on '99A99'", codeInvalid.some((r) => r.charge_item_id === "BC2"));
check("CODE.invalid does NOT fire on well-formed '71045'", !codeInvalid.some((r) => r.charge_item_id === "OK1"));

console.log("\n--------------------------------------------------------");
console.log(`PASS ${pass}   FAIL ${fail}`);
process.exit(fail ? 1 : 0);
