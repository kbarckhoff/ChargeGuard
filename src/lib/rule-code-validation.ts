// ─── Rule code validation (Rule-to-Source check) ─────────────
// Greg's validation list for the November 2026 companion-charge rules asks that
// every expected code be checked against the current CMS files: does the code
// exist, is it retired, what is its OPPS status indicator and packaging, and
// are there NCCI edits between the paired codes. This module holds the code
// relationships being validated and turns the live reference tables
// (cms_reference, ncci_ptp) into a per-rule report. It re-runs whenever the
// reference data refreshes, so the check stays current each quarter.

export interface ValidationGroup {
  rule: string;        // Greg's rule id
  item: number | null; // number on Greg's "what needs to be validated" list
  name: string;
  triggers: string[];
  expected: string[];
}

const w = (s: string) => s.split(/\s+/).filter(Boolean);

export const VALIDATION_GROUPS: ValidationGroup[] = [
  { rule: "CC-10", item: 3, name: "Fluid procedures → fluid studies", triggers: w("32554 32555 49082 49083 62270 62328 20600 20604 20605 20606 20610 20611"), expected: w("89050 89051 89060 82945 84157 83615 82042 87070 87075 87205 88104 88108 88112 88173") },
  { rule: "CC-10", item: 3, name: "Tissue sampling → pathology / cytology", triggers: w("11102 11104 11106 19081 19083 19085 19100 19101 31625 31628 38221 38222 43239 44389 45380 45384 45385 47000 50200 55700 10005 10007 10009 10011 10021"), expected: w("88300 88302 88304 88305 88307 88309 88172 88173 88177") },
  { rule: "CC-10", item: 3, name: "Central line → ultrasound guidance", triggers: w("36555 36556 36557 36558 36568 36569"), expected: w("76937") },
  { rule: "CC-10", item: 3, name: "Fracture care → cast / splint", triggers: w("23500 23505 24500 24505 24650 25500 25530 25600 25605 26600 26605 26720 26725 26750 27750 27752 27786 27788 27808 27810 28470 28475 28490 28510"), expected: w("29075 29125 29405 29515 Q4010 A4570 A4580 A4590") },
  { rule: "CC-11", item: 4, name: "Drug class → administration family", triggers: w("J9035 J1885 J3420 J1030 J1040 J3301 J1050 J2550"), expected: w("96365 96366 96367 96368 96372 96374 96375 96401 96409 96413") },
  { rule: "CC-12", item: 1, name: "Trauma activation: G0390 with 99291", triggers: w("99291"), expected: w("G0390") },
  { rule: "CC-12", item: 1, name: "Adhesive closure: G0168 vs. simple repair", triggers: w("G0168"), expected: w("12001 12002 12004 12005 12006 12007 12011 12013 12014 12015 12016 12017 12018") },
  { rule: "CC-12", item: 8, name: "Medicare vaccine administration G-codes", triggers: w("90686 90662 90670 90677 90732 90746 90739"), expected: w("G0008 G0009 G0010 90471 90472") },
  { rule: "CC-13", item: 2, name: "ED visit → ECG, breathing treatment, urinalysis", triggers: w("99283 99284 99285"), expected: w("93005 94640 94644 94645 81001 81002 81003") },
  { rule: "CC-8", item: 6, name: "Hydration → bulk IV fluid", triggers: w("96360 96361"), expected: w("J7030 J7040 J7042 J7050 J7060 J7070 J7120 J7121") },
  { rule: "CC-6", item: 8, name: "Collection codes (NCCI edits among them)", triggers: w("36415"), expected: w("36416 36591 36592 36600") },
  { rule: "CC-3", item: null, name: "Blood product → transfusion", triggers: w("P9016 P9021 P9035"), expected: w("36430") },
  { rule: "CC-7", item: null, name: "With-contrast exam → contrast agent", triggers: w("70460 71260 74177 70553 72158"), expected: w("Q9951 Q9958 Q9967 A9579 A9585") },
  { rule: "CC-2", item: 8, name: "Arterial puncture / blood gas packaging", triggers: w("82803 82805"), expected: w("36600") },
];

// OPPS status indicator → what it means for valuing a missed charge.
export function packagingNote(si: string | null | undefined): string {
  const s = String(si ?? "").trim().toUpperCase();
  if (!s) return "No status indicator on file";
  if (s === "N") return "Packaged: no separate OPPS payment (value by payer class and cost-report effect)";
  if (/^Q[1-4]$/.test(s)) return `Conditionally packaged (${s}): paid separately only in certain claim combinations`;
  if (/^J[12]$/.test(s)) return `Comprehensive APC (${s}): adjunctive services package into it`;
  if (s === "A") return "Paid under a fee schedule other than OPPS (MPFS / CLFS)";
  if (["S", "T", "V"].includes(s)) return `Separately paid under OPPS (${s})`;
  if (["G", "K"].includes(s)) return `Separately paid drug / biological (${s})`;
  if (["H", "U", "R"].includes(s)) return `Separately paid (${s})`;
  if (s === "B") return "Not recognized by OPPS on a hospital outpatient claim";
  if (["E1", "E2"].includes(s)) return `Not paid by Medicare (${s})`;
  if (s === "M") return "Not billable to the MAC under OPPS";
  if (s === "C") return "Inpatient-only";
  if (["L", "F"].includes(s)) return `Paid at reasonable cost (${s})`;
  return `Status indicator ${s}`;
}

export interface CodeCheck { code: string; role: "trigger" | "expected"; found: boolean; desc: string | null; si: string | null; packaging: string; retired: boolean; mue: number | null }
export interface PtpCheck { col1: string; col2: string; modifierIndicator: string | null; meaning: string }
export interface GroupReport { rule: string; item: number | null; name: string; codes: CodeCheck[]; ptp: PtpCheck[]; issues: string[] }
export interface ValidationReport { generatedAt: string; referenceRows: number; ptpLoaded: boolean; groups: GroupReport[]; summary: { codes: number; missing: number; retired: number; packaged: number; ptpEdits: number } }

const ptpMeaning = (mi: string | null) => mi === "0" ? "Never payable together (no modifier bypass)" : mi === "1" ? "Payable together only with an NCCI-associated modifier" : mi === "9" ? "Edit not applicable" : "Edit present";

/** Run the validation against the live reference tables. `db` is a service-role Supabase client. */
export async function buildValidationReport(db: any): Promise<ValidationReport> {
  const all = [...new Set(VALIDATION_GROUPS.flatMap((g) => [...g.triggers, ...g.expected]))];
  const ref = new Map<string, any>();
  for (let i = 0; i < all.length; i += 200) {
    const { data } = await db.from("cms_reference").select("hcpcs, short_desc, si, retired, mue").in("hcpcs", all.slice(i, i + 200));
    for (const r of (data || []) as any[]) ref.set(String(r.hcpcs).toUpperCase(), r);
  }
  const { count: referenceRows } = await db.from("cms_reference").select("hcpcs", { count: "exact", head: true });

  // NCCI PTP edits between any two codes in the validation set (both directions).
  const ptp = new Map<string, string | null>(); let ptpLoaded = true;
  for (let i = 0; i < all.length; i += 100) {
    const { data, error } = await db.from("ncci_ptp").select("col1, col2, modifier_indicator, deletion").in("col1", all.slice(i, i + 100)).in("col2", all);
    if (error) { ptpLoaded = false; break; }
    for (const r of (data || []) as any[]) { if (r.deletion && String(r.deletion).trim()) continue; ptp.set(`${r.col1}|${r.col2}`, r.modifier_indicator ?? null); }
  }

  const summary = { codes: 0, missing: 0, retired: 0, packaged: 0, ptpEdits: 0 };
  const groups: GroupReport[] = VALIDATION_GROUPS.map((g) => {
    const mk = (code: string, role: "trigger" | "expected"): CodeCheck => {
      const r = ref.get(code.toUpperCase());
      const retired = String(r?.retired ?? "").toUpperCase() === "YES";
      const si = r?.si ? String(r.si).trim().toUpperCase() : null;
      return { code, role, found: !!r, desc: r?.short_desc ?? null, si, packaging: r ? packagingNote(si) : "Not in the current reference", retired, mue: r?.mue ?? null };
    };
    const codes = [...g.triggers.map((c) => mk(c, "trigger")), ...g.expected.map((c) => mk(c, "expected"))];
    const pairs: PtpCheck[] = [];
    for (const a of g.triggers) for (const b of g.expected) for (const [c1, c2] of [[a, b], [b, a]]) {
      const k = `${c1}|${c2}`; if (ptp.has(k)) pairs.push({ col1: c1, col2: c2, modifierIndicator: ptp.get(k) ?? null, meaning: ptpMeaning(ptp.get(k) ?? null) });
    }
    // Edits among the expected codes themselves matter where the rule allows any one of them (collection codes, repair codes).
    for (const a of g.expected) for (const b of g.expected) { if (a === b) continue; const k = `${a}|${b}`; if (ptp.has(k)) pairs.push({ col1: a, col2: b, modifierIndicator: ptp.get(k) ?? null, meaning: ptpMeaning(ptp.get(k) ?? null) }); }

    const issues: string[] = [];
    const missing = codes.filter((c) => !c.found), retired = codes.filter((c) => c.retired);
    const packaged = codes.filter((c) => c.role === "expected" && c.si === "N");
    if (missing.length) issues.push(`Not in the current reference: ${missing.map((c) => c.code).join(", ")}. Confirm the code is current, or remove it from the rule.`);
    if (retired.length) issues.push(`Retired: ${retired.map((c) => c.code).join(", ")}. Replace with the current code.`);
    if (packaged.length) issues.push(`Packaged under OPPS (SI=N): ${packaged.map((c) => c.code).join(", ")}. A missing charge has no separate Medicare outpatient payment; value by payer class.`);
    const hard = pairs.filter((p) => p.modifierIndicator === "0" && g.triggers.includes(p.col1) !== g.triggers.includes(p.col2));
    if (hard.length) issues.push(`NCCI edit with no modifier bypass between a trigger and its expected companion: ${hard.map((p) => `${p.col1}/${p.col2}`).join(", ")}. The companion is not separately payable with that trigger for Medicare; the rule should not prompt for it on Medicare claims.`);
    summary.codes += codes.length; summary.missing += missing.length; summary.retired += retired.length; summary.packaged += packaged.length; summary.ptpEdits += pairs.length;
    return { rule: g.rule, item: g.item, name: g.name, codes, ptp: pairs, issues };
  });
  return { generatedAt: new Date().toISOString(), referenceRows: referenceRows || 0, ptpLoaded, groups, summary };
}

/** Flat CSV of the report, shaped for pasting into the Rule-to-Source Map. */
export function validationCsv(r: ValidationReport): string {
  const q = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Rule", "Validation item", "Relationship", "Row type", "Code / pair", "Role", "In reference", "Description", "OPPS SI", "Packaging / edit meaning", "Retired", "MUE"].map(q).join(",")];
  for (const g of r.groups) {
    for (const c of g.codes) rows.push([g.rule, g.item ?? "", g.name, "Code", c.code, c.role, c.found ? "Yes" : "No", c.desc, c.si, c.packaging, c.retired ? "Yes" : "No", c.mue].map(q).join(","));
    for (const p of g.ptp) rows.push([g.rule, g.item ?? "", g.name, "NCCI PTP", `${p.col1} / ${p.col2}`, "", "", "", "", `Modifier indicator ${p.modifierIndicator ?? "n/a"}: ${p.meaning}`, "", ""].map(q).join(","));
    for (const i of g.issues) rows.push([g.rule, g.item ?? "", g.name, "Issue", "", "", "", "", "", i, "", ""].map(q).join(","));
  }
  return rows.join("\r\n");
}
