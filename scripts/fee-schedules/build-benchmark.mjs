// Build the peer pricing benchmark (Tier 0) from the public CMS file:
//   "Medicare Outpatient Hospitals - by Geography and Service"
// Download the CSV from data.cms.gov (Provider Summary by Type of Service →
// Medicare Outpatient Hospitals → "by Geography and Service" → latest year →
// Download CSV) and point this script at it.
//
// Produces src/lib/pricing-benchmark-data.json: per HCPCS, the national and
// per-state average submitted (gross) charge and Medicare allowed amount, so
// the engine can flag lines priced below or far above what peer OPPS hospitals
// charge for the same code.
//
// Usage:
//   node scripts/fee-schedules/build-benchmark.mjs <file.csv|file.xlsx>
//   node scripts/fee-schedules/build-benchmark.mjs <file.csv> --inspect   # show detected columns + sample, don't write
//
// Handles very large files: CSV input is streamed line-by-line (never loaded
// whole into memory). .xlsx input is read via SheetJS (fine for the geography
// file, which is small; use the CSV for the larger provider file).

import { createReadStream, existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
// NOTE: xlsx is imported lazily in the .xlsx branch so CSV runs have no deps.

const ROOT = process.cwd();
const OUT = join(ROOT, "src", "lib", "pricing-benchmark-data.json");
const DEFAULT_DIR = join(ROOT, "data", "cms-sources", "benchmark");

const args = process.argv.slice(2);
const inspect = args.includes("--inspect");
let input = args.find((a) => !a.startsWith("--"));

// Default: newest .csv/.xlsx in data/cms-sources/benchmark/
if (!input) {
  if (existsSync(DEFAULT_DIR)) {
    const f = readdirSync(DEFAULT_DIR).filter((x) => /\.(csv|xlsx)$/i.test(x)).sort().pop();
    if (f) input = join(DEFAULT_DIR, f);
  }
}
if (!input || !existsSync(input)) {
  console.error("No input file. Pass the CMS Geography-and-Service CSV/XLSX path, or drop it in data/cms-sources/benchmark/.");
  console.error("Usage: node scripts/fee-schedules/build-benchmark.mjs <file.csv|xlsx> [--inspect]");
  process.exit(1);
}

// ── HCPCS normalization (must match src/lib/cms-reference.ts) ──
function normalizeHcpcs(raw) {
  if (raw == null) return "";
  let s = String(raw).trim().toUpperCase();
  if (!s) return "";
  s = s.replace(/\.0+$/, "");
  if (/^\d+$/.test(s)) return s.padStart(5, "0");
  const m = s.match(/^([A-Z])(\d+)$/);
  if (m) return m[1] + m[2].padStart(4, "0");
  return s;
}

// ── US state name → USPS code (state-level rows carry the full name) ──
const STATE = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA","colorado":"CO",
  "connecticut":"CT","delaware":"DE","district of columbia":"DC","florida":"FL","georgia":"GA",
  "hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS","kentucky":"KY",
  "louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA","michigan":"MI","minnesota":"MN",
  "mississippi":"MS","missouri":"MO","montana":"MT","nebraska":"NE","nevada":"NV","new hampshire":"NH",
  "new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH",
  "oklahoma":"OK","oregon":"OR","pennsylvania":"PA","rhode island":"RI","south carolina":"SC",
  "south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT","vermont":"VT","virginia":"VA",
  "washington":"WA","west virginia":"WV","wisconsin":"WI","wyoming":"WY","puerto rico":"PR",
};
function stateCode(desc) {
  const d = String(desc || "").trim().toLowerCase();
  if (STATE[d]) return STATE[d];
  if (/^[a-z]{2}$/i.test(d)) return d.toUpperCase(); // already a code
  return null;
}

const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; };

// quote-aware CSV line splitter (fields may contain commas inside quotes)
function splitCsv(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

// find a column index by header keyword rules
function findCol(headers, { all = [], any = [], not = [] }) {
  const H = headers.map((h) => String(h).toLowerCase().trim());
  for (let i = 0; i < H.length; i++) {
    const h = H[i];
    if (not.some((n) => h.includes(n))) continue;
    if (all.length && !all.every((a) => h.includes(a))) continue;
    if (any.length && !any.some((a) => h.includes(a))) continue;
    if (all.length || any.length) return i;
  }
  return -1;
}

function resolveColumns(headers) {
  return {
    hcpcs:   findCol(headers, { any: ["hcpcs_cd", "hcpcs cd", "hcpcs"], not: ["desc"] }),
    geoLvl:  findCol(headers, { any: ["geo_lvl", "geo lvl", "geo_level", "geography level", "geo level"] }),
    geoDesc: findCol(headers, { all: ["geo"], any: ["desc"], not: ["hcpcs", "apc"] }),
    chg:     findCol(headers, { any: ["sbmtd", "submitted"] }),
    alwd:    findCol(headers, { any: ["alowd", "allowed"] }),
    srvcs:   findCol(headers, { any: ["tot_srvcs", "tot srvcs", "srvcs", "services"], not: ["bene", "capc"] }),
  };
}

// accumulator: acc[hcpcs] = { natl: agg, st: { CA: agg } }; agg = {cw,aw,w,n}
const acc = {};
function add(hcpcs, scope, chg, alwd, w) {
  if (!acc[hcpcs]) acc[hcpcs] = { natl: null, st: {} };
  const bucket = scope === "natl" ? "natl" : "st";
  let target;
  if (bucket === "natl") target = acc[hcpcs].natl || (acc[hcpcs].natl = { cw: 0, aw: 0, w: 0, n: 0 });
  else target = acc[hcpcs].st[scope] || (acc[hcpcs].st[scope] = { cw: 0, aw: 0, w: 0, n: 0 });
  const weight = w > 0 ? w : 1;
  target.cw += chg * weight;
  target.aw += alwd * weight;
  target.w += weight;
  target.n += 1;
}

let COLS = null, rowCount = 0, kept = 0, sampled = [];

function handleRow(cells) {
  if (!COLS) return;
  const hcpcs = normalizeHcpcs(cells[COLS.hcpcs]);
  if (!hcpcs) return;
  const chg = COLS.chg >= 0 ? num(cells[COLS.chg]) : 0;
  if (chg <= 0) return;
  const alwd = COLS.alwd >= 0 ? num(cells[COLS.alwd]) : 0;
  const w = COLS.srvcs >= 0 ? num(cells[COLS.srvcs]) : 0;

  const lvl = COLS.geoLvl >= 0 ? String(cells[COLS.geoLvl] || "").trim().toLowerCase() : "";
  const desc = COLS.geoDesc >= 0 ? String(cells[COLS.geoDesc] || "").trim() : "";
  let scope;
  if (lvl.includes("national") || desc.toLowerCase() === "national") scope = "natl";
  else { const sc = stateCode(desc); if (sc) scope = sc; }
  if (!scope) return;

  add(hcpcs, scope, chg, alwd, w);
  kept++;
  if (sampled.length < 3) sampled.push({ hcpcs, scope, chg, alwd, w });
}

function finalize() {
  const data = {};
  const round = (x) => Math.round(x * 100) / 100;
  for (const [hcpcs, rec] of Object.entries(acc)) {
    const o = {};
    if (rec.natl && rec.natl.w > 0) {
      o.natl = { chg: round(rec.natl.cw / rec.natl.w) };
      if (rec.natl.aw > 0) o.natl.alwd = round(rec.natl.aw / rec.natl.w);
      o.natl.srvcs = Math.round(rec.natl.w);
    }
    const states = Object.entries(rec.st).filter(([, a]) => a.w > 0);
    if (states.length) {
      o.st = {};
      for (const [code, a] of states) {
        o.st[code] = { chg: round(a.cw / a.w) };
        if (a.aw > 0) o.st[code].alwd = round(a.aw / a.w);
        o.st[code].srvcs = Math.round(a.w);
      }
    }
    if (o.natl || o.st) data[hcpcs] = o;
  }

  const yearMatch = String(input).match(/20\d{2}/);
  const outObj = {
    meta: {
      source: "CMS Medicare Outpatient Hospitals - by Geography and Service",
      year: yearMatch ? yearMatch[0] : null,
      generatedAt: new Date().toISOString(),
      inputFile: input.split(/[\\/]/).pop(),
      codes: Object.keys(data).length,
    },
    data,
  };

  if (existsSync(OUT)) {
    const backupDir = join(ROOT, "data", "cms-sources", "backups");
    mkdirSync(backupDir, { recursive: true });
    copyFileSync(OUT, join(backupDir, `pricing-benchmark-data.${Date.now()}.json`));
  }
  writeFileSync(OUT, JSON.stringify(outObj));
  console.log(`\n✅ Wrote ${OUT}`);
  console.log(`   rows read: ${rowCount.toLocaleString()} | rows used: ${kept.toLocaleString()} | HCPCS codes: ${outObj.meta.codes.toLocaleString()} | year: ${outObj.meta.year || "?"}`);
  console.log("   Rebuild the app (delete .next, npm run dev) so the scan picks up the benchmark.");
}

// ── XLSX path (small files) ──
if (/\.xlsx$/i.test(input)) {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(readFileSync(input), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
  const headerIdx = rows.findIndex((r) => r.some((c) => String(c).toLowerCase().includes("hcpcs")));
  const headers = rows[headerIdx] || [];
  COLS = resolveColumns(headers);
  if (inspect) { printInspect(headers); process.exit(0); }
  for (const r of rows.slice(headerIdx + 1)) { rowCount++; handleRow(r); }
  finalize();
} else {
  // ── CSV streaming path ──
  const rl = createInterface({ input: createReadStream(input, "utf8"), crlfDelay: Infinity });
  let headers = null;
  rl.on("line", (line) => {
    if (!line.trim()) return;
    const cells = splitCsv(line);
    if (!headers) {
      headers = cells;
      COLS = resolveColumns(headers);
      if (inspect) { printInspect(headers); rl.close(); process.exit(0); }
      return;
    }
    rowCount++;
    handleRow(cells);
  });
  rl.on("close", () => { if (!inspect) finalize(); });
}

function printInspect(headers) {
  console.log("Detected header row:");
  console.log("  " + headers.map((h, i) => `[${i}] ${h}`).join(" | "));
  console.log("\nResolved columns (index → header):");
  for (const [k, i] of Object.entries(COLS)) {
    console.log(`  ${k.padEnd(8)} → ${i >= 0 ? `[${i}] ${headers[i]}` : "NOT FOUND"}`);
  }
  const missing = Object.entries(COLS).filter(([k, i]) => i < 0 && ["hcpcs", "chg"].includes(k));
  if (missing.length) console.log(`\n⚠️  Required column(s) not found: ${missing.map(([k]) => k).join(", ")} — check the header names above and adjust resolveColumns() if needed.`);
  else console.log("\n✅ Required columns found. Re-run without --inspect to build.");
}
