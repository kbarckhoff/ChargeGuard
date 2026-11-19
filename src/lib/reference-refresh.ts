// ─── Reference Refresh Framework ─────────────────────────────
// The engine behind /api/cron/refresh-reference. For each due source it runs a
// per-source refresher that downloads the current CMS file, parses it into
// reference rows, validates the result, and only then swaps it into the live
// Supabase reference table. A validation failure keeps the existing data and
// records the error — so a CMS format change can never silently corrupt rates.
//
// Adding a source = write its refresher (download + parse to ParsedRow[]) and
// register it in REFRESHERS. Everything else (validation, persistence, metadata,
// the cron trigger, and the Benchmarks status UI) is already wired.

import { createClient } from "@supabase/supabase-js";
import type { SourceStatus } from "./reference-sources";
import { normalizeHcpcs } from "./cms-reference";

// One reference row, keyed by normalized HCPCS. Mirrors the columns in the
// cms_reference table and the CmsReference shape used by the scan.
export interface ParsedRow {
  hcpcs: string;
  short_desc?: string | null;
  si?: string | null;
  apc_payment?: string | null;
  mc_fee?: string | null;
  mc_rvu?: string | null;
  pf_fee?: string | null;
  pf_rvu?: string | null;
  clfs?: string | null;
  asp?: string | null;
  dosage?: string | null;
  retired?: string | null;
  mue?: number | string | null;    // NCCI Medically Unlikely Edit unit cap
  mue_mai?: string | null;         // MUE Adjudication Indicator (1/2/3)
}

export interface RefreshOutcome {
  key: string;
  status: "refreshed" | "failed" | "parser_pending";
  rows?: number;
  vintage?: string;
  cmsUrl?: string;
  error?: string;
}

// A refresher fetches + parses the current release for one source. It returns
// the parsed rows and a human vintage label, or throws on any download/parse
// error (the framework turns that into a "failed" outcome).
type Refresher = (s: SourceStatus) => Promise<{ rows: ParsedRow[]; vintage: string }>;

// Minimum row counts a healthy download must clear — the first line of defense
// against a truncated file or a changed layout that parses to near-nothing.
const MIN_ROWS: Record<string, number> = {
  addendum_b: 8000, addendum_a: 3000, mpfs: 5000, clfs: 1000, asp: 400, hcpcs: 5000, vaccine: 3,
  ncci_mue: 2000,
};

// Which reference column(s) a source owns. On refresh we only overwrite these,
// leaving columns populated by other sources intact.
const OWNED_COLUMNS: Record<string, (keyof ParsedRow)[]> = {
  addendum_b: ["si", "short_desc"],
  addendum_a: ["apc_payment"],
  mpfs: ["mc_fee", "mc_rvu", "pf_fee", "pf_rvu"],
  clfs: ["clfs"],
  asp: ["asp", "dosage"],
  hcpcs: ["retired", "short_desc"],
  vaccine: ["mc_fee", "pf_fee", "si", "short_desc"],
  ncci_mue: ["mue", "mue_mai"],
};

const UA = "Converge reference refresher (+https://chargeguard.app)";

/** Pick a value from a parsed row object by fuzzy header match. */
function pick(row: Record<string, any>, ...needles: string[]): any {
  const keys = Object.keys(row);
  for (const n of needles) {
    const k = keys.find((key) => key.toLowerCase().replace(/\s+/g, " ").trim().includes(n));
    if (k != null) return row[k];
  }
  return undefined;
}

/** Resolve the newest ASP Pricing File zip URL from the CMS ASP landing page. */
async function resolveAspZipUrl(landing: string): Promise<string> {
  const html = await (await fetch(landing, { headers: { "User-Agent": UA } })).text();
  // CMS posts downloads under /files/zip/<name>.zip. Collect candidates that
  // look like the ASP *pricing* file (not the NDC-HCPCS crosswalk).
  const hrefs = Array.from(html.matchAll(/href="([^"]+\.zip)"/gi)).map((m) => m[1]);
  const abs = hrefs.map((h) => (h.startsWith("http") ? h : `https://www.cms.gov${h}`));
  const pricing = abs.filter((u) => /asp/i.test(u) && /pric/i.test(u) && !/crosswalk|ndc/i.test(u));
  const pool = pricing.length ? pricing : abs.filter((u) => /asp/i.test(u));
  if (!pool.length) throw new Error("no ASP zip link found on CMS landing page (page layout may have changed)");
  // Prefer the most recent by any yyyy or yyyy-mm in the filename.
  pool.sort((a, b) => (b.match(/20\d\d/g)?.pop() || "").localeCompare(a.match(/20\d\d/g)?.pop() || ""));
  return pool[0];
}

/** Parse an ASP pricing workbook buffer into reference rows. */
async function parseAspWorkbook(buf: ArrayBuffer): Promise<ParsedRow[]> {
  const AdmZip: any = (await import("adm-zip" as any)).default;
  const XLSX = await import("xlsx");
  const zip = new AdmZip(Buffer.from(buf));
  const entry = zip.getEntries().find((e: any) => /\.(xlsx|xls|csv)$/i.test(e.entryName) && !/crosswalk|ndc/i.test(e.entryName))
    || zip.getEntries().find((e: any) => /\.(xlsx|xls|csv)$/i.test(e.entryName));
  if (!entry) throw new Error("no xlsx/csv inside the ASP zip");
  const wb = XLSX.read(entry.getData(), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // Header row varies; scan the first ~12 rows for one containing "HCPCS".
  const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  let hi = grid.findIndex((r) => r.some((c) => String(c).toLowerCase().includes("hcpcs")));
  if (hi < 0) hi = 0;
  const rows: ParsedRow[] = [];
  const headers = grid[hi].map((c) => String(c ?? ""));
  for (let i = hi + 1; i < grid.length; i++) {
    const obj: Record<string, any> = {};
    grid[i].forEach((c, j) => { obj[headers[j] || `c${j}`] = c; });
    const rawCode = pick(obj, "hcpcs code", "hcpcs");
    const code = normalizeHcpcs(rawCode == null ? "" : String(rawCode));
    if (!code) continue;
    const limit = pick(obj, "payment limit", "limit");
    const dosage = pick(obj, "dosage");
    rows.push({
      hcpcs: code,
      asp: limit == null || limit === "" ? null : String(limit),
      dosage: dosage == null || dosage === "" ? null : String(dosage),
    });
  }
  return rows;
}

// ── NCCI (PTP + MUE) download + parse ────────────────────────
// CMS posts NCCI edits quarterly as zips under /files/zip/. We resolve the newest
// zip for the hospital-outpatient variant, unzip, and parse the first table.
// The CMS NCCI pages link both the full edit tables and small "quarterly
// additions/deletions/revisions" change files. We want the FULL table, so we
// exclude the change files and prefer the full one (usually the larger file).
const NCCI_CHANGE = /addition|deletion|revision|\bchange/i;
async function resolveNcciZipUrl(landing: string, mustMatch: RegExp): Promise<string> {
  const html = await (await fetch(landing, { headers: { "User-Agent": UA } })).text();
  const hrefs = Array.from(html.matchAll(/href="([^"]+\.zip[^"]*)"/gi)).map((m) => m[1]);
  const abs = hrefs.map((h) => (h.startsWith("http") ? h : `https://www.cms.gov${h}`)).map((u) => {
    // CMS gates many downloads behind an AMA-license interstitial
    // (/license/ama?file=/files/zip/…). The real file path is the `file` param.
    const m = u.match(/[?&]file=([^&]+)/);
    return (/\/license\//i.test(u) && m) ? `https://www.cms.gov${decodeURIComponent(m[1])}` : u;
  });
  const pool = abs.filter((u) => /\.zip$/i.test(u) && mustMatch.test(u) && !NCCI_CHANGE.test(u));
  if (!pool.length) throw new Error("no full NCCI zip link on CMS page (only change files, or layout changed)");
  // Prefer the newest year; among those, the shortest URL (full tables have
  // plainer names than the long "...additions-deletions-revisions..." ones).
  pool.sort((a, b) => ((b.match(/20\d\d/g)?.pop() || "").localeCompare(a.match(/20\d\d/g)?.pop() || "")) || (a.length - b.length));
  return pool[0];
}

// Read the data table from an NCCI zip. Handles xlsx/csv/txt, skips the AMA
// license-disclaimer preamble, and finds the real header row (a short cell that
// names a code column), not the long copyright paragraph.
async function readFirstTable(buf: ArrayBuffer): Promise<{ headers: string[]; grid: any[][] }> {
  const AdmZip: any = (await import("adm-zip" as any)).default;
  const XLSX = await import("xlsx");
  const zip = new AdmZip(Buffer.from(buf));
  const dataFiles = zip.getEntries().filter((e: any) => /\.(xlsx|xls|csv|txt)$/i.test(e.entryName) && !NCCI_CHANGE.test(e.entryName));
  if (!dataFiles.length) throw new Error("no data file inside the NCCI zip");
  // Prefer the largest file (full tables dwarf any readme).
  const entry = dataFiles.sort((a: any, b: any) => b.getData().length - a.getData().length)[0];
  const wb = XLSX.read(entry.getData(), { type: "buffer", raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  // Header row = first row with ≥2 SHORT cells that each name a known column.
  // The ≥2 requirement skips the license disclaimer and single-cell title rows
  // (e.g. "Column1/Column2 Edits") that sit above the real header.
  const HDR = /^(hcpcs|cpt|hcpcs\/?cpt|column\s*1|column\s*2|modifier|effective|deletion|mue|adjudication|rationale|units)/i;
  const headerish = (c: any) => { const s = String(c ?? "").trim(); return s.length > 0 && s.length < 40 && HDR.test(s); };
  let hi = grid.findIndex((r) => r.filter(headerish).length >= 2);
  if (hi < 0) hi = grid.findIndex((r) => r.some(headerish));
  if (hi < 0) hi = 0;
  return { headers: grid[hi].map((c) => String(c ?? "")), grid: grid.slice(hi + 1) };
}

// Parse an outpatient-hospital MUE file → per-HCPCS rows (fits cms_reference).
async function parseMueWorkbook(buf: ArrayBuffer): Promise<ParsedRow[]> {
  const { headers, grid } = await readFirstTable(buf);
  const col = (needle: string) => headers.findIndex((h) => h.toLowerCase().includes(needle));
  const ic = col("hcpcs") >= 0 ? col("hcpcs") : col("cpt");
  const iv = headers.findIndex((h) => /mue value|mue values|units/i.test(h));
  const im = headers.findIndex((h) => /adjudication|\bmai\b/i.test(h));
  const rows: ParsedRow[] = [];
  for (const r of grid) {
    const code = normalizeHcpcs(String(r[ic] ?? ""));
    if (!code) continue;
    const v = parseInt(String(r[iv] ?? "").replace(/[^\d-]/g, ""), 10);
    rows.push({ hcpcs: code, mue: Number.isFinite(v) ? v : null, mue_mai: im >= 0 ? (r[im] == null ? null : String(r[im])) : null });
  }
  return rows;
}

// Parse an outpatient-hospital PTP file → code-pair rows (own table).
interface PtpRow { col1: string; col2: string; modifier_indicator: string | null; effective: string | null; deletion: string | null }
async function parsePtpWorkbook(buf: ArrayBuffer): Promise<PtpRow[]> {
  const { headers, grid } = await readFirstTable(buf);
  const find = (re: RegExp) => headers.findIndex((h) => re.test(h));
  // CMS publishes the outpatient PTP table under a single merged title cell
  // ("Column1/Column2 Edits") with NO per-column header, so fall back to the
  // fixed published column order: Col1, Col2, [* pre-1996], Effective, Deletion,
  // Modifier, Rationale. Detect that layout by sampling the first data rows.
  let i1 = find(/column\s*1/i), i2 = find(/column\s*2/i);
  let im = find(/modifier/i), ie = find(/effective/i), id = find(/deletion/i);
  // A single merged title cell ("Column1/Column2 Edits") matches both regexes at
  // the same index — that is NOT a real two-column header, so force positional.
  if (i1 < 0 || i2 < 0 || i1 === i2) {
    // Positional: the two code columns are the first two cells of a data row
    // that both look like HCPCS/CPT codes. Modifier is the 0/1/9 column.
    const sample = grid.slice(0, 50).filter((r) => normalizeHcpcs(String(r[0] ?? "")) && normalizeHcpcs(String(r[1] ?? "")));
    if (sample.length) {
      i1 = 0; i2 = 1;
      const width = Math.max(...sample.map((r) => r.length));
      // Modifier indicator column = the one whose values are all 0/1/9.
      im = -1;
      for (let c = 2; c < width; c++) {
        if (sample.every((r) => /^[019]$/.test(String(r[c] ?? "").trim()))) { im = c; break; }
      }
      // Effective/deletion = the date-like columns (YYYYMMDD or M/D/YYYY).
      const dateCols = [];
      for (let c = 2; c < width; c++) {
        if (sample.some((r) => /\d{8}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(String(r[c] ?? "").trim()))) dateCols.push(c);
      }
      ie = dateCols[0] ?? -1; id = dateCols[1] ?? -1;
    }
  }
  // Collapse to one row per pair = its current definition (prefer the row that
  // is still active, then the latest effective date). The source lists a pair
  // more than once when an edit was superseded or re-dated.
  const byPair = new Map<string, PtpRow>();
  const score = (r: PtpRow) => (r.deletion ? 0 : 1_000_000_0000) + (parseInt(String(r.effective ?? "").replace(/\D/g, "").slice(0, 8), 10) || 0);
  for (const r of grid) {
    const c1 = normalizeHcpcs(String(r[i1] ?? "")), c2 = normalizeHcpcs(String(r[i2] ?? ""));
    if (!c1 || !c2) continue;
    const row: PtpRow = {
      col1: c1, col2: c2,
      modifier_indicator: im >= 0 ? String(r[im] ?? "").trim().slice(0, 1) || null : null,
      effective: ie >= 0 ? (r[ie] == null ? null : String(r[ie])) : null,
      deletion: id >= 0 ? (String(r[id] ?? "").trim() && !/^\*+$/.test(String(r[id]).trim()) ? String(r[id]) : null) : null,
    };
    const key = `${c1}|${c2}`;
    const prev = byPair.get(key);
    if (!prev || score(row) > score(prev)) byPair.set(key, row);
  }
  return Array.from(byPair.values());
}

/** PTP has its own table (pairs, not per-HCPCS), so it bypasses persist(). */
export async function refreshNcciPtpTable(s: SourceStatus): Promise<RefreshOutcome> {
  try {
    const zipUrl = await resolveNcciZipUrl(s.cmsUrl, /hospital|outpatient/i);
    const resp = await fetch(zipUrl, { headers: { "User-Agent": UA } });
    const buf = await resp.arrayBuffer();
    // Diagnostic guard: confirm we actually got a zip (starts with "PK").
    const head = Buffer.from(buf.slice(0, 4)).toString("latin1");
    if (head.slice(0, 2) !== "PK") {
      const text = Buffer.from(buf.slice(0, 160)).toString("utf8").replace(/\s+/g, " ");
      throw new Error(`DIAG not-a-zip url=${zipUrl} status=${resp.status} ctype=${resp.headers.get("content-type")} bytes=${buf.byteLength} head=${JSON.stringify(text)}`);
    }
    const rows = await parsePtpWorkbook(buf);
    if (rows.length < 50_000) {
      await recordFailure(s.key, `only ${rows.length} pairs parsed — likely a CMS layout change`);
      return { key: s.key, status: "failed", error: "too few pairs" };
    }
    const db = admin();
    await db.from("ncci_ptp").delete().neq("id", 0);
    let written = 0;
    const BATCH = 5000;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      // upsert on the pair key so any residual duplicate is absorbed, not fatal.
      const { error } = await db.from("ncci_ptp").upsert(slice, { onConflict: "col1,col2", ignoreDuplicates: true });
      if (error) throw new Error(`ncci_ptp insert failed @${i}: ${error.message}`);
      written += slice.length;
    }
    const vintage = (zipUrl.match(/20\d\d/g)?.pop()) || String(new Date().getUTCFullYear());
    await admin().from("cms_reference_sources").upsert({ key: s.key, vintage, last_refreshed: new Date().toISOString(), row_count: written, status: "ok", last_error: null }, { onConflict: "key" });
    return { key: s.key, status: "refreshed", rows: written, vintage };
  } catch (e: any) {
    const msg = e?.message || String(e);
    await recordFailure(s.key, msg);
    return { key: s.key, status: "failed", error: msg };
  }
}

// Per-source refreshers. Sources without one report "parser_pending" (the cron
// still runs and reports them). Heavy files (MPFS, Addendum A/B, CLFS, HCPCS,
// NCCI) are pulled by the scheduled GitHub Action instead (see .github/workflows),
// which has more headroom than a serverless function.
const REFRESHERS: Record<string, Refresher> = {
  ncci_mue: async (s) => {
    const zipUrl = await resolveNcciZipUrl(s.cmsUrl, /hospital|outpatient/i);
    const buf = await (await fetch(zipUrl, { headers: { "User-Agent": UA } })).arrayBuffer();
    const rows = await parseMueWorkbook(buf);
    const qm = zipUrl.match(/(20\d\d)q([1-4])/i);
    const vintage = qm ? `${qm[1]} Q${qm[2]}` : ((zipUrl.match(/20\d\d/g)?.pop()) || String(new Date().getUTCFullYear()));
    return { rows, vintage };
  },
  asp: async (s) => {
    const zipUrl = await resolveAspZipUrl(s.cmsUrl);
    const buf = await (await fetch(zipUrl, { headers: { "User-Agent": UA } })).arrayBuffer();
    const rows = await parseAspWorkbook(buf);
    const yr = (zipUrl.match(/20\d\d/g)?.pop()) || new Date().getUTCFullYear();
    return { rows, vintage: String(yr) };
  },
};

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/** Validate a parsed release before it is allowed to replace live data. */
function validate(key: string, rows: ParsedRow[]): string | null {
  if (!Array.isArray(rows) || rows.length === 0) return "no rows parsed";
  const min = MIN_ROWS[key] ?? 1;
  if (rows.length < min) return `only ${rows.length} rows parsed (expected ≥ ${min}) — likely a format change`;
  const withCode = rows.filter((r) => r.hcpcs && String(r.hcpcs).trim()).length;
  if (withCode / rows.length < 0.95) return "more than 5% of rows are missing a HCPCS key";
  return null;
}

/** Upsert the owned columns for a source into cms_reference, then update its
 *  metadata row. Throws if the reference tables aren't provisioned yet. */
async function persist(key: string, rows: ParsedRow[], vintage: string): Promise<number> {
  const db = admin();
  const cols = OWNED_COLUMNS[key] || [];
  // Upsert in batches to stay under payload limits.
  let written = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000).map((r) => {
      const rec: Record<string, any> = { hcpcs: r.hcpcs };
      for (const c of cols) rec[c] = (r as any)[c] ?? null;
      return rec;
    });
    const { error } = await db.from("cms_reference").upsert(batch, { onConflict: "hcpcs" });
    if (error) throw new Error(`persist failed (is the cms_reference table provisioned?): ${error.message}`);
    written += batch.length;
  }
  await db.from("cms_reference_sources").upsert(
    { key, vintage, last_refreshed: new Date().toISOString(), row_count: written, status: "ok", last_error: null },
    { onConflict: "key" }
  );
  return written;
}

/** Record a failed refresh in metadata without touching the live data. */
async function recordFailure(key: string, error: string) {
  try {
    await admin().from("cms_reference_sources").upsert(
      { key, status: "error", last_error: error, last_checked: new Date().toISOString() },
      { onConflict: "key" }
    );
  } catch { /* metadata table may not exist yet — swallow */ }
}

export async function refreshSource(s: SourceStatus): Promise<RefreshOutcome> {
  // NCCI PTP writes code-pairs to its own table, not cms_reference.
  if (s.key === "ncci_ptp") return refreshNcciPtpTable(s);
  const refresher = REFRESHERS[s.key];
  if (!refresher) return { key: s.key, status: "parser_pending", cmsUrl: s.cmsUrl };
  try {
    const { rows, vintage } = await refresher(s);
    const bad = validate(s.key, rows);
    if (bad) {
      await recordFailure(s.key, bad);
      return { key: s.key, status: "failed", error: bad };
    }
    const written = await persist(s.key, rows, vintage);
    return { key: s.key, status: "refreshed", rows: written, vintage };
  } catch (e: any) {
    const msg = e?.message || String(e);
    await recordFailure(s.key, msg);
    return { key: s.key, status: "failed", error: msg };
  }
}
