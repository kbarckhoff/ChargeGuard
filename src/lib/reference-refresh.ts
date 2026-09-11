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
};

const UA = "ChargeGuard reference refresher (+https://chargeguard.app)";

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

// Per-source refreshers. Sources without one report "parser_pending" (the cron
// still runs and reports them). Heavy files (MPFS, Addendum A/B, CLFS, HCPCS)
// are pulled by the scheduled GitHub Action instead (see .github/workflows),
// which has more headroom than a serverless function.
const REFRESHERS: Record<string, Refresher> = {
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
