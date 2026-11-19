/* Parser + data-gated-rule verification.
 * (1) Runs the REAL Converge parsers against the mock upload CSVs and checks the
 *     parsed rows (header mapping, numeric/bool coercion).
 * (2) Proves the MUE rule fires once the reference overlay carries MUE data, by
 *     loading a stub reference through the real loadReferenceFromDb path.
 */
import * as fs from "fs";
import { parseClaimsExtract, parseItemMaster, parseGlDepartments } from "@/lib/converge-inputs-parser";
import { loadReferenceFromDb, getReference } from "@/lib/cms-reference";
import { runMueRules } from "@/lib/ncci-rules";

const DIR = process.env.MOCK_DIR || "/sessions/hopeful-wonderful-mayer/mnt/Converge/mock-test-data";
const read = (f: string) => fs.readFileSync(`${DIR}/${f}`, "utf8");

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, got?: any) => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${got !== undefined ? "  got=" + JSON.stringify(got) : ""}`); }
};

console.log("\n(1) PARSERS — real parsers on the mock CSVs");

const ce = parseClaimsExtract(read("04_claims_extract.csv"));
check("claims-extract: 10 rows parsed", ce.rows.length === 10, ce.rows.length);
const x4 = ce.rows.find((r) => r.claim_id === "X4");
check("claims-extract: X4 maps HCPCS 96372", x4?.hcpcs === "96372", x4?.hcpcs);
check("claims-extract: X4 maps denial CARC 197", x4?.denial_code === "197", x4?.denial_code);
check("claims-extract: X4 billed=500 (numeric)", x4?.billed_amount === 500, x4?.billed_amount);
const x6 = ce.rows.find((r) => r.claim_id === "X6");
check("claims-extract: X6 allowed=400", x6?.allowed_amount === 400, x6?.allowed_amount);
check("claims-extract: X3 dx R07.9 mapped", ce.rows.find((r) => r.claim_id === "X3")?.dx_code === "R07.9");
check("claims-extract: X9 units=99 mapped", ce.rows.find((r) => r.claim_id === "X9")?.units === 99);

const im = parseItemMaster(read("05_item_master.csv"));
check("item-master: 2 rows parsed", im.rows.length === 2, im.rows.length);
const imx1 = im.rows.find((r) => r.item_number === "IMX1");
check("item-master: IMX1 is_device=true", imx1?.is_device === true, imx1?.is_device);
check("item-master: IMX1 c_code C1874", imx1?.c_code === "C1874", imx1?.c_code);
check("item-master: IMX1 charge_code DEVF", imx1?.charge_code === "DEVF", imx1?.charge_code);
check("item-master: IMX2 rev 0999", im.rows.find((r) => r.item_number === "IMX2")?.rev_code === "0999");

const gl = parseGlDepartments(read("06_gl_departments.csv"));
check("gl: 6 rows parsed", gl.rows.length === 6, gl.rows.length);
check("gl: Laboratory prefix 030", gl.rows.find((r) => r.department_name === "Laboratory")?.charge_prefix === "030");

console.log("\n(2) MUE rule — fires when the reference overlay carries MUE data");
// Stub DB: first page returns one code with an MUE of 2; subsequent pages empty.
let page = 0;
const stubDb = {
  from: (_t: string) => ({
    select: (_c: string) => ({
      range: async (_a: number, _b: number) => {
        if (page++ === 0) return { data: [{ hcpcs: "82040", short_desc: "Albumin", mue: 2, mue_mai: "3" }], error: null };
        return { data: [], error: null };
      },
    }),
  }),
};
(async () => {
  const n = await loadReferenceFromDb(stubDb);
  check("reference overlay loaded (1 code)", n === 1, n);
  check("getReference(82040).mue === 2", getReference("82040")?.mue === 2, getReference("82040")?.mue);
  const cdm = [{ id: "c1", hcpcs_cpt_code: "82040", charge_description: "Albumin" }];
  const claims = [{ claim_id: "K1", hcpcs: "82040", mod1: null, mod2: null, mod3: null, mod4: null, units: 5, billed_amount: 30 }];
  const res = runMueRules(cdm as any, claims as any);
  check("MUE rule fires (5 units > cap of 2)", res.some((r) => r.rule_id === "NCCI.mue"), res.map((r) => r.rule_id));

  console.log("\n--------------------------------------------------------");
  console.log(`PASS ${pass}   FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
