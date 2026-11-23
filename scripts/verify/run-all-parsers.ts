/* Import-layer robustness audit: runs every standalone parser against the mock
 * files (valid) and against malformed/empty inputs (must not throw, must return
 * a sane shape). Mirrors what the browser does before each import POST. */
import * as fs from "fs";
import { parseClaims } from "@/lib/claims-parser";
import { parseClaimsExtract, parseItemMaster, parseGlDepartments } from "@/lib/converge-inputs-parser";
import { parseMrf } from "@/lib/mrf-parser";

const DIR = process.env.MOCK_DIR || "/sessions/hopeful-wonderful-mayer/mnt/Converge/mock-test-data";
const read = (f: string) => fs.readFileSync(`${DIR}/${f}`, "utf8");
let pass = 0, fail = 0;
const ok = (n: string, c: boolean, got?: any) => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${got !== undefined ? "  got=" + JSON.stringify(got) : ""}`)); };
const noThrow = (n: string, fn: () => any) => { try { const r = fn(); ok(n + " (no throw)", true); return r; } catch (e: any) { ok(n + " (no throw)", false, e?.message); return null; } };

console.log("\n(A) VALID FILES");
const cl = parseClaims(read("08_claims_837csv.csv"));
ok("claims CSV: 5 lines parsed", cl.rows.length === 5, cl.rows.length);
ok("claims CSV: C1001 line1 HCPCS 99283", cl.rows[0]?.hcpcs === "99283", cl.rows[0]?.hcpcs);
ok("claims CSV: line_charge numeric", Number(cl.rows[0]?.line_charge) === 540, cl.rows[0]?.line_charge);

const ce = parseClaimsExtract(read("04_claims_extract.csv"));
ok("claims-extract: >=10 rows", ce.rows.length >= 10, ce.rows.length);

const im = parseItemMaster(read("05_item_master.csv"));
ok("item-master: 2 rows + device flag", im.rows.length === 2 && im.rows.some((r) => r.is_device === true), im.rows.length);

const gl = parseGlDepartments(read("06_gl_departments.csv"));
ok("gl: 6 rows", gl.rows.length === 6, gl.rows.length);

const mrf = parseMrf(read("07_peer_mrf_competitor.csv"));
ok("MRF CSV: 5 price rows", mrf.rows.length === 5, mrf.rows.length);
ok("MRF CSV: 71046 gross=310", mrf.rows.find((r: any) => r.hcpcs === "71046")?.gross === 310, mrf.rows.find((r: any) => r.hcpcs === "71046")?.gross);
// competitor is supplied via the UI field on import, not required from the file.

// MRF JSON (CMS schema)
const mrfJson = JSON.stringify({ hospital_name: "Test JSON Hosp", standard_charge_information: [
  { code_information: [{ code: "71046", type: "HCPCS" }], standard_charges: [{ gross_charge: 299, setting: "outpatient" }] },
  { code_information: [{ code: "85025", type: "HCPCS" }], standard_charges: [{ gross_charge: 88, setting: "outpatient" }] },
]});
const mj = parseMrf(mrfJson);
ok("MRF JSON: 2 rows", mj.rows.length === 2, mj.rows.length);

console.log("\n(B) MALFORMED / EMPTY (must not throw, must return sane shape)");
for (const [name, fn] of [
  ["parseClaims empty", () => parseClaims("")],
  ["parseClaims header-only", () => parseClaims("Claim ID,HCPCS\n")],
  ["parseClaims junk", () => parseClaims("@@@\n###\n,,,,")],
  ["parseClaimsExtract empty", () => parseClaimsExtract("")],
  ["parseClaimsExtract 1 line", () => parseClaimsExtract("just one line no newline")],
  ["parseItemMaster empty", () => parseItemMaster("")],
  ["parseGlDepartments empty", () => parseGlDepartments("")],
  ["parseMrf empty", () => parseMrf("")],
  ["parseMrf bad JSON", () => parseMrf("{not valid json")],
  ["parseMrf csv no code col", () => parseMrf("foo,bar\n1,2")],
] as [string, () => any][]) {
  const r = noThrow(name, fn);
  if (r) ok(name + " returns rows[]", Array.isArray(r.rows), Object.keys(r));
}

console.log("\n--------------------------------------------------------");
console.log(`PASS ${pass}   FAIL ${fail}`);
process.exit(fail ? 1 : 0);
