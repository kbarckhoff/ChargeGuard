// ─── CONVERGE / ChargeGuard standalone engine (offline, no server, no DB) ─────
//
// This is the "installable" engine: point it at a local folder of client files
// and it runs the SAME rule library the hosted app uses, entirely offline, and
// writes the findings to a local folder. No network, no database, nothing leaves
// the machine. This is the piece that can run inside a client's environment.
//
//   npx tsx engine/run.ts --in <folder> --out <folder>
//
// The input folder should contain (CSV; names are matched loosely):
//   *CDM*.csv        required  — the chargemaster
//   *RU*.csv         optional  — utilization & actual charges (volumes/$)
//   *Formulary*.csv  optional  — pharmacy formulary
//
// Reference data (CMS fee schedules / status indicators) is bundled into the
// code, so the engine is fully self-contained.

import fs from "fs";
import path from "path";
import Papa from "papaparse";

import { runRules } from "../src/lib/structural-rules";
import {
  runReferenceRules, runDeviceCrosswalkRules, runCodingUpdateRules,
  runPriceTransparencyRules, runMultiplierRules, runFormularyRules,
  runInternalPricingRules, runRvuRules, runBenchmarkRules, type RuleResult,
} from "../src/lib/cdm-reference-rules";
import { runModifierRules } from "../src/lib/cdm-reference-rules";
import { runPeerCompetitorRules } from "../src/lib/peer-rules";
import { referenceSource } from "../src/lib/cms-reference";

// ── tiny arg parser ──
function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const inDir = arg("in", "data/test-client")!;
const outDir = arg("out", "engine/output")!;
const lowVolumeThreshold = Number(arg("lowVolume", "10")) || 10;

// ── load a CSV file into row objects ──
function readCsv(file: string): Record<string, any>[] {
  const text = fs.readFileSync(file, "utf8");
  const res = Papa.parse(text, { header: true, skipEmptyLines: true });
  return (res.data as Record<string, any>[]).filter((r) => Object.keys(r).length);
}
function findFile(dir: string, re: RegExp): string | null {
  const hit = fs.readdirSync(dir).find((f) => re.test(f) && f.toLowerCase().endsWith(".csv"));
  return hit ? path.join(dir, hit) : null;
}

// Map real-world CDM column headers to the canonical field names the rules use,
// so files like "HCPCS/CPT Code" or "Gross Charge" load the same as snake_case.
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const CDM_ALIASES: Record<string, string[]> = {
  procedure_number: ["procedure number", "charge code", "charge master code", "cdm code", "item number"],
  charge_description: ["charge description", "description", "item description"],
  hcpcs_cpt_code: ["hcpcs cpt code", "hcpcs cpt", "hcpcs", "cpt", "cpt hcpcs", "hcpcs code"],
  revenue_code: ["revenue code", "rev code", "rev cd"],
  gross_charge: ["gross charge", "price", "charge amount", "amount"],
  ndc_code: ["ndc code", "ndc"],
  modifier_1: ["modifier 1", "mod 1", "modifier"],
  modifier_2: ["modifier 2", "mod 2"],
  modifier_3: ["modifier 3", "mod 3"],
  department: ["department", "dept"],
};
function canonRow(r: Record<string, any>): Record<string, any> {
  const byNorm: Record<string, any> = {};
  for (const [k, v] of Object.entries(r)) byNorm[norm(k)] = v;
  const out: Record<string, any> = {};
  for (const [field, aliases] of Object.entries(CDM_ALIASES)) {
    for (const a of aliases) if (byNorm[a] !== undefined && byNorm[a] !== "") { out[field] = byNorm[a]; break; }
  }
  return out;
}

function main() {
  if (!fs.existsSync(inDir)) { console.error(`Input folder not found: ${inDir}`); process.exit(1); }
  const cdmFile = findFile(inDir, /cdm/i);
  if (!cdmFile) { console.error(`No *CDM*.csv found in ${inDir}`); process.exit(1); }
  const ruFile = findFile(inDir, /(^|_)ru(_|\.|$)|utiliz/i);
  const formFile = findFile(inDir, /formular/i);

  console.log(`CONVERGE engine — offline run`);
  console.log(`  CDM:       ${path.basename(cdmFile)}`);
  console.log(`  R&U:       ${ruFile ? path.basename(ruFile) : "(none)"}`);
  console.log(`  Formulary: ${formFile ? path.basename(formFile) : "(none)"}`);

  // CDM lines — canonicalize headers so varied column names map to our fields.
  const items = readCsv(cdmFile).map((raw, i) => {
    const r = canonRow(raw);
    return {
      id: String(r.procedure_number || `row-${i + 1}`),
      procedure_number: r.procedure_number ?? null,
      charge_description: r.charge_description ?? "",
      hcpcs_cpt_code: r.hcpcs_cpt_code ?? "",
      revenue_code: r.revenue_code ?? "",
      gross_charge: r.gross_charge ?? 0,
      ndc_code: r.ndc_code ?? "",
      modifier_1: r.modifier_1 ?? "", modifier_2: r.modifier_2 ?? "", modifier_3: r.modifier_3 ?? "",
      department: r.department ?? "",
    };
  });

  // R&U → usageByCode keyed by charge code.
  const usageByCode = new Map<string, any>();
  if (ruFile) for (const r of readCsv(ruFile)) {
    const key = String(r.charge_code ?? r.procedure_number ?? "").trim();
    if (key) usageByCode.set(key, { units: r.units ?? 0, gross: r.gross ?? 0, modifier: r.modifier ?? "" });
  }

  // Formulary → formularyByCode + the set of pharmacy charge codes.
  const formularyByCode = new Map<string, any>();
  const formularyCodes = new Set<string>();
  if (formFile) for (const r of readCsv(formFile)) {
    const key = String(r.charge_code ?? "").trim();
    if (!key) continue;
    formularyByCode.set(key, { status: r.status ?? "", ndc: r.ndc ?? "", drug_name: r.drug_name ?? "", pkg_amt: r.pkg_amt ?? "", pkg_unit: r.pkg_unit ?? "" });
    formularyCodes.add(key);
  }

  // ── run the engine (same rule functions as the hosted app) ──
  const findings: RuleResult[] = [
    ...runRules(items),
    ...runReferenceRules(items, usageByCode),
    ...runDeviceCrosswalkRules(items),
    ...runCodingUpdateRules(items, usageByCode),
    ...runPriceTransparencyRules(items),
    ...runMultiplierRules(items),
    ...runFormularyRules(items, formularyByCode, usageByCode),
    ...runModifierRules(items, usageByCode),
    ...runInternalPricingRules(items),
    ...runRvuRules(items, usageByCode, lowVolumeThreshold),
    ...runBenchmarkRules(items, null, formularyCodes),
    ...runPeerCompetitorRules(items, [], formularyCodes),
  ];

  // ── write outputs locally ──
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "findings.json"), JSON.stringify(findings, null, 2));
  const cols = ["rule_id", "category", "severity", "financial_impact", "charge_item_id", "title", "recommendation"];
  const csv = Papa.unparse(findings.map((f: any) => Object.fromEntries(cols.map((c) => [c, f[c] ?? ""]))), { columns: cols });
  fs.writeFileSync(path.join(outDir, "findings.csv"), csv);

  // ── console summary ──
  const byCat = new Map<string, { n: number; impact: number }>();
  let totalImpact = 0;
  for (const f of findings as any[]) {
    const e = byCat.get(f.category) || { n: 0, impact: 0 };
    e.n++; e.impact += Number(f.financial_impact) || 0; byCat.set(f.category, e);
    totalImpact += Number(f.financial_impact) || 0;
  }
  console.log(`\nReference data: ${referenceSource()} (bundled = offline)`);
  console.log(`CDM lines: ${items.length.toLocaleString()}  |  Findings: ${findings.length.toLocaleString()}  |  Gross-charge impact: $${Math.round(totalImpact).toLocaleString()}`);
  console.log(`\nFindings by category:`);
  for (const [cat, e] of [...byCat.entries()].sort((a, b) => b[1].impact - a[1].impact || b[1].n - a[1].n)) {
    console.log(`  ${String(e.n).padStart(5)}  ${e.impact ? "$" + Math.round(e.impact).toLocaleString() : "—"}`.padEnd(22) + `  ${cat}`);
  }
  console.log(`\nWrote: ${path.join(outDir, "findings.json")} + findings.csv`);
}

main();
