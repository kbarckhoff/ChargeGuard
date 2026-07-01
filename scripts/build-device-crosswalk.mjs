// Regenerates src/lib/device-crosswalk-data.json from the living crosswalk
// workbook. Run this whenever Carol/CMS updates the workbook each January.
// Usage:  node scripts/build-device-crosswalk.mjs [path-to-workbook.xlsx]
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

const ROOT = process.cwd();
const WB = process.argv[2] || join(ROOT, "data", "reference-workbooks", "CMS_Device_Procedure_Crosswalk_Reference.xlsx");
const OUT = join(ROOT, "src", "lib", "device-crosswalk-data.json");

const wb = XLSX.read(readFileSync(WB), { type: "buffer" });
const sheet = (name) => {
  const key = wb.SheetNames.find((s) => s.toLowerCase().includes(name));
  return key ? XLSX.utils.sheet_to_json(wb.Sheets[key], { header: 1, raw: true, defval: "" }) : [];
};
const cell = (r, i) => (r[i] == null ? "" : String(r[i]).trim());

// Sheet "1. Proc→Device"
const proc = sheet("proc→device").length ? sheet("proc→device") : sheet("proc");
const procToDevice = [];
for (const r of proc.slice(3)) {
  const cpt = cell(r, 0);
  if (!/^\d{4,5}$/.test(cpt)) continue;
  const cc = [cell(r, 4), cell(r, 6), cell(r, 8)].filter((c) => /^C\d{4}$/.test(c));
  const lr = cell(r, 9).toUpperCase();
  const logic = lr.includes("AND") ? "AND" : lr.includes("OR") || lr.includes("EITHER") ? "OR" : "single";
  procToDevice.push({ cpt, family: cell(r, 2), ccodes: cc, logic, desc: cell(r, 1), risk: cell(r, 11) });
}

// Sheet "2. Device→Proc"
const dev = sheet("device→proc").length ? sheet("device→proc") : sheet("device");
const deviceCategories = [];
for (const r of dev.slice(3)) {
  const cat = cell(r, 0);
  const kw = cell(r, 1);
  if (!cat || cat.length > 55 || cat.toLowerCase().includes("update r&u")) continue;
  if (cat.toLowerCase().includes("unclassified")) { deviceCategories.push({ category: cat, keywords: [], ccodes: [], cptFamily: [] }); continue; }
  const keywords = kw.split(/[/,]/).map((k) => k.trim().toUpperCase()).filter((k) => k && k !== "..." && !/pending|lines/i.test(k));
  deviceCategories.push({
    category: cat,
    keywords,
    ccodes: (cell(r, 2).match(/C\d{4}/g) || []),
    cptFamily: (cell(r, 4).match(/\d{4,5}/g) || []),
  });
}

writeFileSync(OUT, JSON.stringify({
  procToDevice, deviceCategories,
  source: "CMS_Device_Procedure_Crosswalk_Reference.xlsx (living reference; CMS I/OCE Edit Spec + OPPS device list, update each January)",
}, null, 1));
console.log(`✅ ${OUT}`);
console.log(`   ${procToDevice.length} procedure→device rules, ${deviceCategories.length} device categories.`);
