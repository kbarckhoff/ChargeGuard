/* Exercises the rule-code validation report against a stub reference (no network). */
import { buildValidationReport, validationCsv, VALIDATION_GROUPS, packagingNote } from "@/lib/rule-code-validation";
let pass = 0, fail = 0;
const check = (n: string, c: boolean, got?: any) => { c ? (pass++, console.log(`  PASS  ${n}`)) : (fail++, console.log(`  FAIL  ${n}${got !== undefined ? "  got=" + JSON.stringify(got) : ""}`)); };
const REF: any[] = [
  { hcpcs: "99291", short_desc: "Critical care first hour", si: "J2", retired: null, mue: 1 },
  { hcpcs: "G0390", short_desc: "Trauma respons w/hosp criti", si: "S", retired: null, mue: 1 },
  { hcpcs: "76937", short_desc: "Us guide vascular access", si: "N", retired: null, mue: 2 },
  { hcpcs: "36556", short_desc: "Insert non-tunnel cv cath", si: "T", retired: null, mue: 2 },
  { hcpcs: "36415", short_desc: "Routine venipuncture", si: "Q4", retired: null, mue: 2 },
  { hcpcs: "36416", short_desc: "Capillary blood draw", si: "N", retired: "YES", mue: 0 },
];
const PTP: any[] = [{ col1: "36415", col2: "36416", modifier_indicator: "0", deletion: "" }, { col1: "36556", col2: "76937", modifier_indicator: "1", deletion: null }];
const q = (rows: any[]) => { const st: any = { rows, f: [] as ((r: any) => boolean)[] }; const api: any = {
  select: (_c: string, o?: any) => { if (o?.head) return Promise.resolve({ count: rows.length }); return api; },
  in: (col: string, vals: string[]) => { st.f.push((r: any) => vals.includes(r[col])); return api; },
  then: (res: any) => res({ data: st.rows.filter((r: any) => st.f.every((f: any) => f(r))), error: null }) }; return api; };
const db = { from: (t: string) => q(t === "cms_reference" ? REF : PTP) };
(async () => {
  const r = await buildValidationReport(db);
  const g = (name: string) => r.groups.find((x) => x.name.startsWith(name))!;
  check("one report group per validation group", r.groups.length === VALIDATION_GROUPS.length);
  check("G0390 found with SI=S", g("Trauma").codes.find((c) => c.code === "G0390")?.si === "S");
  check("76937 reported as packaged", g("Central line").issues.some((i) => i.includes("Packaged") && i.includes("76937")), g("Central line").issues);
  check("PTP edit 36556/76937 listed with modifier indicator 1", g("Central line").ptp.some((p) => p.col1 === "36556" && p.col2 === "76937" && p.modifierIndicator === "1"), g("Central line").ptp);
  check("missing codes are reported", g("Central line").issues.some((i) => i.startsWith("Not in the current reference")));
  check("retired code is reported", g("Collection").issues.some((i) => i.startsWith("Retired") && i.includes("36416")), g("Collection").issues);
  check("hard NCCI edit between trigger and companion is called out", g("Collection").issues.some((i) => i.includes("no modifier bypass") && i.includes("36415/36416")), g("Collection").issues);
  check("packaging note: Q1 conditional, N packaged", packagingNote("Q1").startsWith("Conditionally") && packagingNote("N").startsWith("Packaged"));
  const csv = validationCsv(r);
  check("CSV has a header and rows", csv.split("\r\n").length > 100 && csv.startsWith('"Rule"'), csv.split("\r\n").length);
  console.log(`PASS ${pass}   FAIL ${fail}`); process.exit(fail ? 1 : 0);
})();
