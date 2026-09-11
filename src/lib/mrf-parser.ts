// ─── Hospital Price-Transparency MRF Parser ──────────────────
// Parses a competitor's machine-readable file (CMS standard template — JSON
// schema, or "tall"/"wide" CSV) into { competitor, rows:[{hcpcs, gross}] }.
// Real MRFs are large (100s of MB) and vary in layout, so the CSV path exposes
// reusable header/row helpers the browser uploader uses to STREAM the file
// line-by-line instead of loading it all into memory.

import { normalizeHcpcs } from "./cms-reference";

export interface PeerPriceRow { hcpcs: string; gross: number }
export interface MrfResult { competitor: string | null; rows: PeerPriceRow[]; format: "json" | "csv" | "unknown"; note?: string }

export const num = (v: any): number => {
  if (v == null || v === "") return 0;
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? 0 : n;
};
export const norm = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
export const isHcpcsLike = (s: string) => /^[A-Z0-9]{5}$/.test(String(s || "").trim().toUpperCase());

// Collapse a competitor's multiple lines per code to one representative gross
// (median), so every competitor is aggregated the same way regardless of format.
export function dedupeMedian(pairs: PeerPriceRow[]): PeerPriceRow[] {
  const byCode = new Map<string, number[]>();
  for (const p of pairs) {
    if (!p.hcpcs || p.gross <= 0) continue;
    if (!byCode.has(p.hcpcs)) byCode.set(p.hcpcs, []);
    byCode.get(p.hcpcs)!.push(p.gross);
  }
  return [...byCode.entries()].map(([hcpcs, vals]) => {
    const s = vals.sort((a, b) => a - b);
    return { hcpcs, gross: s[Math.floor(s.length / 2)] };
  });
}

// quote-aware CSV line splitter
export function splitCsvLine(line: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  }
  out.push(cur); return out;
}

// A real header row has an actual code column AND a gross-charge column — matched
// by specific normalized names so the CMS attestation prose (which contains words
// like "encoded"/"standard charge") can't be mistaken for the header.
function isCodeHeader(c: string) { return /^code\d$/.test(c) || c === "hcpcs" || c === "hcpcscpt" || c === "cpt" || c === "apc"; }
function isGrossHeader(c: string) { return (c.includes("standardcharge") && c.includes("gross")) || c === "grosscharge"; }

export interface CsvConfig { grossIdx: number; codeCols: { ci: number; ti: number; direct: boolean }[] }

export function buildCsvConfig(headerCells: string[]): CsvConfig | null {
  const h = headerCells.map(norm);
  let grossIdx = h.findIndex((c) => c.includes("standardcharge") && c.includes("gross"));
  if (grossIdx < 0) grossIdx = h.findIndex((c) => c === "grosscharge");
  const codeCols: { ci: number; ti: number; direct: boolean }[] = [];
  for (let n = 1; n <= 6; n++) {
    const ci = h.indexOf("code" + n);
    if (ci >= 0) codeCols.push({ ci, ti: h.indexOf("code" + n + "type"), direct: false });
  }
  for (const name of ["hcpcs", "hcpcscpt", "cpt"]) {
    const ci = h.indexOf(name);
    if (ci >= 0) codeCols.push({ ci, ti: -1, direct: true });
  }
  if (grossIdx < 0 || codeCols.length === 0) return null;
  return { grossIdx, codeCols };
}

// Extract the HCPCS/CPT + gross from a data row, given the detected config.
export function extractCsvRow(cells: string[], cfg: CsvConfig): PeerPriceRow | null {
  let hc = "";
  for (const { ci, ti, direct } of cfg.codeCols) {
    const raw = cells[ci];
    if (!raw) continue;
    if (ti >= 0) { const t = cells[ti] || ""; if (!/hcpcs|cpt/i.test(t)) continue; }
    else if (!isHcpcsLike(raw)) continue;
    const n = normalizeHcpcs(raw);
    if (n) { hc = n; break; }
  }
  if (!hc) return null;
  const gross = num(cells[cfg.grossIdx]);
  return gross > 0 ? { hcpcs: hc, gross } : null;
}

// From the first lines of a CSV, find the header row index and hospital name.
export function findHeaderInfo(lines: string[]): { hi: number; competitor: string | null } {
  let hi = -1;
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]).map(norm);
    if (cells.some(isCodeHeader) && cells.some(isGrossHeader)) { hi = i; break; }
  }
  let competitor: string | null = null;
  const scanTo = hi >= 0 ? hi : Math.min(lines.length, 6);
  for (let i = 0; i < scanTo; i++) {
    const cells = splitCsvLine(lines[i]);
    const idx = cells.map(norm).indexOf("hospitalname");
    if (idx >= 0) {
      const vals = splitCsvLine(lines[i + 1] || "");
      if (vals[idx] && vals[idx].trim()) { competitor = vals[idx].trim(); break; }
    }
  }
  return { hi, competitor };
}

// Aggregate the distinct gross prices a competitor lists for one code.
export function aggregate(values: number[], method: string): number {
  const v = values.filter((x) => x > 0);
  if (!v.length) return 0;
  if (method === "max") return Math.max(...v);
  if (method === "average") return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]; // median (default)
}

export interface CsvPreview {
  hi: number;                 // physical header line index (for streaming)
  headers: string[];          // raw header cells
  sample: string[][];         // first non-empty data rows
  competitor: string | null;
  def: { codeIdx: number; typeIdx: number; grossIdx: number };
}

// Read the header + a few rows from the START of a CSV so the UI can show and
// let the user confirm which columns hold the code and the gross charge.
export function previewCsv(text: string): CsvPreview {
  const raw = text.split(/\r?\n/);
  const { hi, competitor } = findHeaderInfo(raw.slice(0, 40));
  if (hi < 0) return { hi: -1, headers: [], sample: [], competitor, def: { codeIdx: -1, typeIdx: -1, grossIdx: -1 } };
  const headers = splitCsvLine(raw[hi]);
  const cfg = buildCsvConfig(headers);
  const sample = raw.slice(hi + 1).filter((l) => l.trim()).slice(0, 10).map(splitCsvLine);
  const def = { codeIdx: -1, typeIdx: -1, grossIdx: cfg ? cfg.grossIdx : -1 };
  if (cfg) {
    // Default the code column to the one whose type shows HCPCS/CPT most in the sample.
    let best = cfg.codeCols[0], bestScore = -1;
    for (const cc of cfg.codeCols) {
      let score = 0;
      for (const row of sample) {
        const rawv = row[cc.ci]; if (!rawv) continue;
        if (cc.ti >= 0) { if (/hcpcs|cpt/i.test(row[cc.ti] || "")) score++; }
        else if (isHcpcsLike(rawv)) score++;
      }
      if (score > bestScore) { bestScore = score; best = cc; }
    }
    def.codeIdx = best.ci; def.typeIdx = best.ti;
  }
  return { hi, headers, sample, competitor, def };
}

// ── JSON (CMS schema) ──
function parseJson(text: string): MrfResult {
  let data: any;
  try { data = JSON.parse(text); } catch { return { competitor: null, rows: [], format: "unknown", note: "invalid JSON" }; }
  const competitor = data.hospital_name || data.hospitalName || data.name || null;
  const pairs: PeerPriceRow[] = [];
  const items = data.standard_charge_information || data.standardChargeInformation || (Array.isArray(data) ? data : null);
  if (Array.isArray(items)) {
    for (const it of items) {
      let code: string | null = null;
      const ci = it.code_information || it.codeInformation || it.codes;
      if (Array.isArray(ci)) {
        // Only accept a code explicitly typed HCPCS/CPT. Never fall back to the
        // first code — LOCAL/CDM/RC ids (e.g. a "86631" supply identifier) can
        // collide with real CPT numbers and would create false comparisons.
        const hit = ci.find((c: any) => /hcpcs|cpt/i.test(c.type || c.code_type || ""));
        code = hit ? (hit.code || hit.value || null) : null;
      } else if (/hcpcs|cpt/i.test(it.code_type || it.type || "")) {
        code = it.code || it.hcpcs || it.cpt || null;
      }
      // A code can carry several standard_charge entries (per setting + billing
      // class). Pick the OUTPATIENT FACILITY gross so we compare like-for-like
      // with an outpatient CDM, instead of grabbing whichever is listed first
      // (which may be an inpatient or higher "both" price).
      let gross = 0;
      const sc = it.standard_charges || it.standardCharges;
      if (Array.isArray(sc)) {
        let bestScore = -1;
        for (const s of sc) {
          const g = num(s.gross_charge ?? s.grossCharge ?? s.gross);
          if (g <= 0) continue;
          const setting = String(s.setting || "").toLowerCase();
          const cls = String(s.billing_class ?? s.billingClass ?? "").toLowerCase();
          const score = (setting === "outpatient" ? 3 : setting === "both" ? 2 : setting === "" ? 1 : 0) + (cls === "facility" ? 1 : cls === "" ? 0 : -2);
          if (score > bestScore) { bestScore = score; gross = g; }
        }
      } else gross = num(it.gross_charge ?? it.grossCharge ?? it.gross ?? it.standard_charge);
      const hc = normalizeHcpcs(code);
      if (hc && gross > 0) pairs.push({ hcpcs: hc, gross });
    }
  }
  return { competitor, rows: dedupeMedian(pairs), format: "json" };
}

// ── CSV (whole-text; used for smaller files / Node tests) ──
function parseCsv(text: string): MrfResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { competitor: null, rows: [], format: "csv", note: "empty" };
  const { hi, competitor } = findHeaderInfo(lines.slice(0, 30));
  if (hi < 0) return { competitor, rows: [], format: "csv", note: "no header row with a code + gross column found" };
  const cfg = buildCsvConfig(splitCsvLine(lines[hi]));
  if (!cfg) return { competitor, rows: [], format: "csv", note: "couldn't locate code/gross columns" };
  const pairs: PeerPriceRow[] = [];
  for (let i = hi + 1; i < lines.length; i++) {
    const row = extractCsvRow(splitCsvLine(lines[i]), cfg);
    if (row) pairs.push(row);
  }
  return { competitor, rows: dedupeMedian(pairs), format: "csv" };
}

export function parseMrf(text: string): MrfResult {
  if (!text || !text.trim()) return { competitor: null, rows: [], format: "unknown", note: "empty file" };
  const t = text.trimStart();
  if (t.startsWith("{") || t.startsWith("[")) return parseJson(text);
  return parseCsv(text);
}
