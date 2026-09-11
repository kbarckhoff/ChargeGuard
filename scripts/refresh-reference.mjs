// ─── CMS reference refresh (GitHub Action + manual) ──────────
// Pulls the free public CMS files, validates each download, and upserts the
// owned columns into Supabase cms_reference. Same validate-before-swap guard as
// the in-app refresher: a bad/format-changed file records an error and leaves
// the live data untouched. Heavy files belong here (a GH runner has far more
// headroom than a serverless function).
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/refresh-reference.mjs
//   ONLY=clfs,asp node scripts/refresh-reference.mjs      # subset
//   FORCE=true node scripts/refresh-reference.mjs         # ignore due dates
import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const UA = "ChargeGuard reference refresher";

const norm = (v) => {
  if (v == null) return "";
  let s = String(v).trim().toUpperCase().replace(/\.0+$/, "");
  if (/^\d+$/.test(s)) return s.padStart(5, "0");
  const m = s.match(/^([A-Z])(\d+)$/);
  return m ? m[1] + m[2].padStart(4, "0") : s;
};
const pick = (row, ...needles) => {
  const keys = Object.keys(row);
  for (const n of needles) {
    const k = keys.find((key) => key.toLowerCase().replace(/\s+/g, " ").trim().includes(n));
    if (k != null) return row[k];
  }
  return undefined;
};

async function resolveZip(landing, include, exclude = []) {
  const html = await (await fetch(landing, { headers: { "User-Agent": UA } })).text();
  const hrefs = Array.from(html.matchAll(/href="([^"]+\.zip)"/gi)).map((m) => m[1]);
  const abs = hrefs.map((h) => (h.startsWith("http") ? h : `https://www.cms.gov${h}`));
  let pool = abs.filter((u) => include.every((i) => new RegExp(i, "i").test(u)) && !exclude.some((e) => new RegExp(e, "i").test(u)));
  if (!pool.length) pool = abs.filter((u) => include.slice(0, 1).every((i) => new RegExp(i, "i").test(u)));
  if (!pool.length) throw new Error(`no matching zip on ${landing} (layout may have changed)`);
  pool.sort((a, b) => (b.match(/20\d\d/g)?.pop() || "").localeCompare(a.match(/20\d\d/g)?.pop() || ""));
  return pool[0];
}

async function gridFromZip(zipUrl, excludeEntry = "crosswalk|ndc") {
  const buf = await (await fetch(zipUrl, { headers: { "User-Agent": UA } })).arrayBuffer();
  const zip = new AdmZip(Buffer.from(buf));
  const entry = zip.getEntries().find((e) => /\.(xlsx|xls|csv)$/i.test(e.entryName) && !new RegExp(excludeEntry, "i").test(e.entryName))
    || zip.getEntries().find((e) => /\.(xlsx|xls|csv)$/i.test(e.entryName));
  if (!entry) throw new Error("no xlsx/csv inside zip");
  const wb = XLSX.read(entry.getData(), { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  let hi = grid.findIndex((r) => r.some((c) => String(c).toLowerCase().includes("hcpcs")));
  if (hi < 0) hi = 0;
  const headers = grid[hi].map((c) => String(c ?? ""));
  const rows = [];
  for (let i = hi + 1; i < grid.length; i++) {
    const o = {}; grid[i].forEach((c, j) => { o[headers[j] || `c${j}`] = c; }); rows.push(o);
  }
  return rows;
}

// Read EVERY xlsx/csv entry (and every sheet) in a zip as [{name, rows[][]}].
// MPFS zips carry several files (PPRRVU, GPCI, OPPSCAP…), so single-sheet
// reading isn't enough — we pick the right table by name below.
async function tablesFromZip(zipUrl) {
  const buf = await (await fetch(zipUrl, { headers: { "User-Agent": UA } })).arrayBuffer();
  const zip = new AdmZip(Buffer.from(buf));
  const tables = [];
  for (const e of zip.getEntries()) {
    if (!/\.(xlsx|xls|csv)$/i.test(e.entryName)) continue;
    let wb; try { wb = XLSX.read(e.getData(), { type: "buffer" }); } catch { continue; }
    for (const sheet of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, blankrows: false });
      if (rows.length) tables.push({ name: `${e.entryName}:${sheet}`, rows });
    }
  }
  return tables;
}
const numval = (v) => { const n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; };
function findHeaderRow(rows, hints) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const short = rows[i].map((c) => String(c)).filter((c) => c.length <= 40).map((c) => c.toLowerCase());
    if (hints.filter((h) => short.some((c) => c.includes(h))).length >= 2) return i;
  }
  return -1;
}
function pickTable(tables, { prefer = [], avoid = [], hints = [] }) {
  for (const re of prefer) { const t = tables.find((t) => re.test(t.name) && !avoid.some((a) => a.test(t.name))); if (t) return t; }
  return tables.find((t) => !avoid.some((a) => a.test(t.name)) && findHeaderRow(t.rows, hints) >= 0) || tables[0];
}

// CY2026 non-QP conversion factor (CMS PFS final rule). UPDATE each January.
const MPFS_CONVERSION_FACTOR = 33.40;

// key → { cadence, effective(ISO), cmsUrl, owned:[cols], minRows, refresh():ParsedRow[] }
const SOURCES = {
  asp: {
    cadence: "quarterly", effective: "2026-07-01", owned: ["asp", "dosage"], minRows: 400,
    cmsUrl: "https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files",
    refresh: async (s) => {
      const url = await resolveZip(s.cmsUrl, ["asp", "pric"], ["crosswalk", "ndc"]);
      const rows = await gridFromZip(url);
      return rows.map((r) => ({ hcpcs: norm(pick(r, "hcpcs code", "hcpcs")), asp: str(pick(r, "payment limit", "limit")), dosage: str(pick(r, "dosage")) }))
        .filter((r) => r.hcpcs);
    },
  },
  clfs: {
    cadence: "annual", effective: "2026-01-01", owned: ["clfs"], minRows: 1000,
    cmsUrl: "https://www.cms.gov/medicare/payment/fee-schedules/clinical-laboratory-fee-schedule/clinical-laboratory-fee-schedule-files",
    refresh: async (s) => {
      const url = await resolveZip(s.cmsUrl, ["clfs"]);
      const rows = await gridFromZip(url);
      return rows.map((r) => ({ hcpcs: norm(pick(r, "hcpcs")), clfs: str(pick(r, "rate", "payment")) }))
        .filter((r) => r.hcpcs && r.clfs);
    },
  },
  addendum_b: {
    // Addendum B carries the per-HCPCS status indicator, short description AND the
    // OPPS payment rate, so it feeds apc_payment directly (no separate A→B join).
    cadence: "quarterly", effective: "2026-04-01", owned: ["si", "short_desc", "apc_payment"], minRows: 8000,
    cmsUrl: "https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient/addendum-and-addendum-b-updates",
    refresh: async (s) => {
      const url = await resolveZip(s.cmsUrl, ["b"], ["addendum.?a\\b"]);
      const rows = await gridFromZip(url);
      return rows.map((r) => ({
        hcpcs: norm(pick(r, "hcpcs")),
        si: str(pick(r, "status indicator", "si")),
        short_desc: str(pick(r, "short desc", "descriptor")),
        apc_payment: str(pick(r, "payment rate", "payment")),
      })).filter((r) => r.hcpcs);
    },
  },
  mpfs: {
    // National fee = total RVUs x conversion factor. Uses the PPRRVU file (nonQPP
    // variant), reading the fixed positional columns; base codes only (no 26/TC).
    cadence: "quarterly", effective: "2026-01-01", owned: ["mc_fee", "pf_fee"], minRows: 5000,
    cmsUrl: "https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files",
    refresh: async (s) => {
      const url = await resolveZip(s.cmsUrl, ["rvu"], ["gpci", "oppscap"]);
      const tables = await tablesFromZip(url);
      const t = pickTable(tables, { prefer: [/pprrvu.*nonqpp.*\.xlsx/i, /pprrvu.*\.xlsx/i, /pprrvu/i], avoid: [/gpci|oppscap|narrative|readme|layout|[^n]qpp/i], hints: ["hcpcs"] });
      if (!t) return [];
      const hi = t.rows.findIndex((r) => String(r[0]).trim().toUpperCase() === "HCPCS");
      if (hi < 0) return [];
      const C = { hcpcs: 0, mod: 1, work: 5, nonfacPE: 6, facPE: 8, mp: 10, nonfacTotal: 11, facTotal: 12 };
      const cf = MPFS_CONVERSION_FACTOR;
      const out = [];
      for (const r of t.rows.slice(hi + 1)) {
        if (String(r[C.mod] ?? "").trim() !== "") continue; // base code only
        const code = norm(r[C.hcpcs]);
        if (!/^[A-Z0-9]{5}$/.test(code)) continue;
        const nonFac = numval(r[C.nonfacTotal]) || (numval(r[C.work]) + numval(r[C.nonfacPE]) + numval(r[C.mp]));
        const fac = numval(r[C.facTotal]) || (numval(r[C.work]) + numval(r[C.facPE]) + numval(r[C.mp]));
        const rec = { hcpcs: code };
        if (nonFac > 0) rec.mc_fee = (nonFac * cf).toFixed(2);
        if (fac > 0) rec.pf_fee = (fac * cf).toFixed(2);
        if (rec.mc_fee || rec.pf_fee) out.push(rec);
      }
      return out;
    },
  },
  // HCPCS retired-code flagging stays manual on purpose: auto-marking codes retired
  // from a possibly-partial active list can wrongly flag many codes. Enable only
  // after a validated set-difference pass (see scripts/fee-schedules).
  hcpcs: { cadence: "quarterly", effective: "2026-04-01", owned: ["retired"], minRows: 5000,
    cmsUrl: "https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update", refresh: null },
};

const str = (v) => (v == null || v === "" ? null : String(v).trim());

function nextRelease(cadence, from) {
  const y = from.getUTCFullYear();
  if (cadence === "annual") { const jan = Date.UTC(y, 0, 1); return new Date(from.getTime() >= jan ? Date.UTC(y + 1, 0, 1) : jan); }
  for (const m of [0, 3, 6, 9]) { const d = Date.UTC(y, m, 1); if (d > from.getTime()) return new Date(d); }
  return new Date(Date.UTC(y + 1, 0, 1));
}
const isDue = (s) => Date.now() >= nextRelease(s.cadence, new Date(s.effective + "T00:00:00Z")).getTime();

function validate(rows, minRows) {
  if (!rows?.length) return "no rows parsed";
  if (rows.length < minRows) return `only ${rows.length} rows (expected ≥ ${minRows}) — likely a format change`;
  if (rows.filter((r) => r.hcpcs).length / rows.length < 0.95) return ">5% of rows missing a HCPCS key";
  return null;
}

async function persist(key, owned, rows, vintage) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const batch = rows.slice(i, i + 1000).map((r) => { const rec = { hcpcs: r.hcpcs }; for (const c of owned) rec[c] = r[c] ?? null; return rec; });
    const { error } = await db.from("cms_reference").upsert(batch, { onConflict: "hcpcs" });
    if (error) throw new Error(error.message);
    written += batch.length;
  }
  await db.from("cms_reference_sources").upsert({ key, vintage, status: "ok", row_count: written, last_refreshed: new Date().toISOString(), last_error: null }, { onConflict: "key" });
  return written;
}

const only = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
const force = String(process.env.FORCE).toLowerCase() === "true";

const targets = Object.entries(SOURCES).filter(([k, s]) => (only.length ? only.includes(k) : (force || isDue(s))));
console.log(`Refreshing: ${targets.map(([k]) => k).join(", ") || "(nothing due)"}`);

let failures = 0;
for (const [key, s] of targets) {
  if (!s.refresh) { console.log(`  ${key}: parser pending — skipped`); continue; }
  try {
    const rows = await s.refresh(s);
    const bad = validate(rows, s.minRows);
    if (bad) throw new Error(bad);
    const n = await persist(key, s.owned, rows, String(new Date().getUTCFullYear()));
    console.log(`  ${key}: refreshed ${n} rows`);
  } catch (e) {
    failures++;
    console.error(`  ${key}: FAILED — ${e.message}`);
    try { await db.from("cms_reference_sources").upsert({ key, status: "error", last_error: e.message, last_checked: new Date().toISOString() }, { onConflict: "key" }); } catch {}
  }
}
process.exit(failures ? 1 : 0);
