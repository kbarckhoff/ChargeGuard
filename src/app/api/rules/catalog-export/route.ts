import { NextResponse } from "next/server";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { RULE_CATALOG, RULE_FIELDS, RULE_FORMULA } from "@/lib/rule-catalog";
import * as XLSX from "xlsx-js-style";

export const maxDuration = 60;

// Export the full rule library (name, plain-language logic, engine IDs, data
// source) as a branded Excel workbook — the shareable spec of what the engine
// checks. Generated from rule-catalog.ts so it never drifts from the scan.
const INK = "1E2A44", BRAND = "0A6CFF", TINT = "EEF3FF", ZEBRA = "F7F9FC", LINE = "D9DEE8";
const thin = { style: "thin", color: { rgb: LINE } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const TITLE = { font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } }, fill: { patternType: "solid", fgColor: { rgb: INK } }, alignment: { vertical: "center" } };
const SUB = { font: { sz: 10, color: { rgb: "C4D2E8" } }, fill: { patternType: "solid", fgColor: { rgb: INK } } };
const SUMBAR = { font: { bold: true, sz: 11, color: { rgb: INK } }, fill: { patternType: "solid", fgColor: { rgb: TINT } } };
const COLHEAD = { fill: { patternType: "solid", fgColor: { rgb: BRAND } }, font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "left", vertical: "center", wrapText: true }, border: BORDER };
const GROUPROW = { font: { bold: true, sz: 11, color: { rgb: INK } }, fill: { patternType: "solid", fgColor: { rgb: "DCE6FF" } } };

const DATA: Record<string, string> = {
  "Missing data & structure": "Chargemaster",
  "Coding & status indicators": "Chargemaster + CMS reference (OPPS Addendum B)",
  "Pricing": "Chargemaster + CMS fee schedules + peer/competitor price files",
  "Pricing integrity (internal)": "Chargemaster",
  "Revenue codes": "Chargemaster",
  "Devices": "Chargemaster + CMS device C-code crosswalk",
  "Modifiers & laterality": "Chargemaster + CMS",
  "Units & billing multiplier": "Chargemaster + CMS",
  "Pharmacy": "Chargemaster + formulary file + CMS ASP",
  "Labs": "Chargemaster + CMS CLFS",
  "Add-on codes": "Chargemaster + CMS",
  "RVU / volume": "Chargemaster + usage/RVU file",
  "Compliance": "Chargemaster",
  "Price transparency (shoppable services)": "Chargemaster + required shoppable list",
};

const H = ["#", "Group", "Rule", "What it checks (logic)", "Exact formula / condition", "Input fields used (file: columns)", "Engine rule IDs", "Applies to", "Data source"];
const COLS = [{ wch: 5 }, { wch: 26 }, { wch: 32 }, { wch: 48 }, { wch: 60 }, { wch: 50 }, { wch: 16 }, { wch: 15 }, { wch: 34 }];
const N = H.length;

export async function GET() {
  const sc = await createSessionClient();
  const { data: { user } } = await sc.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const aoa: any[][] = [
    ["ChargeGuard — Rule Library"],
    ["Rule library specification  ·  Generated " + new Date().toLocaleDateString()],
    [""],
    [""],
    H,
  ];
  const headerRow = 4;
  let count = 0;
  const groupRows: number[] = [];
  for (const g of RULE_CATALOG) {
    groupRows.push(aoa.length);
    aoa.push([g.group, "", "", "", "", "", ""]);
    for (const it of g.items) {
      count++;
      aoa.push([count, g.group, it.name, it.desc, RULE_FORMULA[it.key] || "", RULE_FIELDS[it.key] || "CDM", it.ids.join(", "), (it as any).facilities ? "Outpatient (OPPS)" : "All facilities", DATA[g.group] || "Chargemaster"]);
    }
  }
  aoa[2] = [`${count} rules across ${RULE_CATALOG.length} groups`];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = COLS;
  ws["!rows"] = [{ hpt: 24 }, { hpt: 15 }, { hpt: 18 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: N - 1 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: N - 1 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: N - 1 } }];
  for (const gr of groupRows) ws["!merges"]!.push({ s: { r: gr, c: 0 }, e: { r: gr, c: N - 1 } });
  const set = (r: number, c: number, s: any) => { const a = XLSX.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { t: "s", v: "" }; ws[a].s = s; };
  for (let c = 0; c < N; c++) { set(0, c, TITLE); set(1, c, SUB); set(2, c, SUMBAR); set(headerRow, c, COLHEAD); }
  const groupSet = new Set(groupRows);
  for (let r = headerRow + 1; r < aoa.length; r++) {
    if (groupSet.has(r)) { for (let c = 0; c < N; c++) set(r, c, GROUPROW); continue; }
    const z = (r - headerRow) % 2 === 0;
    for (let c = 0; c < N; c++) { const a = XLSX.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { t: "s", v: "" }; ws[a].s = { border: BORDER, alignment: { vertical: "top", wrapText: c === 3 || c === 4 || c === 5 || c === 8 }, ...(z ? { fill: { patternType: "solid", fgColor: { rgb: ZEBRA } } } : {}) }; }
  }
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: headerRow, c: N - 1 } }) };
  ws["!freeze"] = { xSplit: 0, ySplit: headerRow + 1, topLeftCell: XLSX.utils.encode_cell({ r: headerRow + 1, c: 0 }), activePane: "bottomLeft", state: "frozen" };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Rule Library");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="chargeguard-rule-library.xlsx"`,
    },
  });
}
