// ─── CMS reference refresh (GitHub Action + manual) ──────────
// Pulls the free public CMS files, validates each download, and upserts the
// owned columns into Supabase cms_reference. Same validate-before-swap guard as
// the in-app refresher: a bad/format-changed file records an error and leaves
// the live data untouched.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/refresh-reference.mjs
//   ONLY=clfs,asp node scripts/refresh-reference.mjs      # subset
//   FORCE=true node scripts/refresh-reference.mjs         # ignore due dates
//
// Resolver strategy (CMS landing pages are JS-rendered, so scraping them for a
// .zip link fails): each source builds an ordered list of DIRECT candidate URLs
// at https://www.cms.gov/files/zip/<slug>.zip for the most recent quarters and
// probes them; if none resolve it falls back to scraping a page's HTML for any
// /files/zip/*.zip href (also unwrapping CMS "?file=" license links).
import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const UA = "Mozilla/5.0 (ChargeGuard reference refresher)";

const norm = (v) => {
  if (v == null) return "";
  let s = String(v).trim().toUpperCase().replace(/\.0+$/, "");
  if (/^\d+$/.test(s)) return s.padStart(5, "0");
  const m = s.match(/^([A-Z])(\d+)$/);
  return m ? m[1] + m[2].padStart(4, "0") : s;
};
const str = (v) => (v == null || v === "" ? null : String(v).trim());
const num = (v) => { const n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; };
const pick = (row, ...needles) => {
  const keys = Object.keys(row);
  for (const n of needles) {
    const k = keys.find((key) => key.toLowerCase().replace(/\s+/g, " ").trim().includes(n));
    if (k != null) return row[k];
  }
  return undefined;
};

// ── Robust zip resolution ──
// The 3 most recent quarter releases (next/current/prev), newest first, so we
// pick the newest that's actually posted (CMS posts Q4 around Oct 1, etc).
const QMONTH = ["january", "april", "july", "october"];
function quarterCandidates(now = new Date()) {
  const out = [];
  const y = now.getUTCFullYear();
  for (const yy of [y + 1, y, y - 1]) {
    for (let qi = 3; qi >= 0; qi--) {
      const start = Date.UTC(yy, qi * 3, 1);
      if (start <= now.getTime() + 35 * 86400000) out.push({ m: QMONTH[qi], y: yy, qn: qi + 1, letter: "ABCD"[qi], start });
    }
  }
  out.sort((a, b) => b.start - a.start);
  return out.slice(0, 3);
}
async function fetchBuf(url, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      // 5xx / 429 are transient (CMS gateway timeouts) — wait and retry.
      if ((res.status >= 500 || res.status === 429) && attempt < tries) { await new Promise((r) => setTimeout(r, 3000 * attempt)); continue; }
      if (!res.ok) return null;
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      const buf = Buffer.from(await res.arrayBuffer());
      // A real zip starts with "PK"; guards against HTML 200s / soft-404s.
      if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) return buf;
      if (ct.includes("zip")) return buf;
      return null;
    } catch (e) {
      if (attempt >= tries) throw e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
  return null;
}
// Try direct candidate URLs (slugs under /files/zip/), first hit wins.
async function tryDirect(slugs) {
  for (const s of slugs) {
    const url = s.startsWith("http") ? s : `https://www.cms.gov/files/zip/${s}`;
    try { const buf = await fetchBuf(url); if (buf) return { buf, url }; } catch { /* next */ }
  }
  return null;
}
// Fallback: scrape a page's HTML for any /files/zip/*.zip href (unwrapping the
// CMS "?file=/files/zip/..." AMA-license links), filter by include/exclude, pick
// the newest by embedded 20xx, and download it.
async function scrapePage(pageUrl, include = [], exclude = []) {
  let html;
  try { html = await (await fetch(pageUrl, { headers: { "User-Agent": UA } })).text(); } catch { return null; }
  const zips = new Set();
  for (const m of html.matchAll(/(?:href|file)=["']?([^"'&> ]*\/files\/zip\/[^"'&> ]+\.zip)/gi)) {
    let u = m[1];
    if (u.includes("file=")) u = decodeURIComponent(u.split("file=").pop());
    zips.add(u.startsWith("http") ? u : `https://www.cms.gov${u}`);
  }
  let pool = [...zips].filter((u) => include.every((i) => new RegExp(i, "i").test(u)) && !exclude.some((e) => new RegExp(e, "i").test(u)));
  if (!pool.length) pool = [...zips];
  pool.sort((a, b) => (b.match(/20\d\d/g)?.pop() || "").localeCompare(a.match(/20\d\d/g)?.pop() || ""));
  for (const u of pool) { try { const buf = await fetchBuf(u); if (buf) return { buf, url: u }; } catch { /* next */ } }
  return null;
}
async function resolveZip({ slugs = [], pages = [], include = [], exclude = [] }) {
  const direct = await tryDirect(slugs);
  if (direct) return direct;
  for (const p of pages) { const hit = await scrapePage(p, include, exclude); if (hit) return hit; }
  throw new Error("no resolvable zip (tried direct slugs + page scrape; CMS layout/date may have shifted)");
}

// ── Spreadsheet extraction ──
// All tables (every xlsx/csv/txt entry × every sheet) from a zip buffer.
function tablesFromZip(buf, excludeEntry = "crosswalk|ndc|readme|layout") {
  const zip = new AdmZip(buf);
  const tables = [];
  for (const e of zip.getEntries()) {
    if (!/\.(xlsx|xls|csv|txt)$/i.test(e.entryName)) continue;
    if (new RegExp(excludeEntry, "i").test(e.entryName)) continue;
    let wb; try { wb = XLSX.read(e.getData(), { type: "buffer" }); } catch { continue; }
    for (const sheet of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, blankrows: false });
      if (rows.length) tables.push({ name: `${e.entryName}:${sheet}`, rows });
    }
  }
  return tables;
}
// Header-keyed rows from the table that yields the MOST rows (avoids picking a
// cover/notes sheet that merely mentions "HCPCS").
function rowsFromZip(buf, hint = "hcpcs") {
  const tables = tablesFromZip(buf);
  let best = [];
  for (const t of tables) {
    const hi = t.rows.findIndex((r) => r.some((c) => String(c).toLowerCase().includes(hint)));
    if (hi < 0) continue;
    const headers = t.rows[hi].map((c) => String(c ?? ""));
    const out = [];
    for (let i = hi + 1; i < t.rows.length; i++) { const o = {}; t.rows[i].forEach((c, j) => { o[headers[j] || `c${j}`] = c; }); out.push(o); }
    if (out.length > best.length) best = out;
  }
  return best;
}
// Raw text of the first zip entry matching `re` (for fixed-width files like CLFS).
function rawTextFromZip(buf, re) {
  const zip = new AdmZip(buf);
  const e = zip.getEntries().find((x) => re.test(x.entryName) && !/readme|layout|record/i.test(x.entryName));
  return e ? e.getData().toString("latin1") : "";
}
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

// key → { cadence, effective, owned:[cols], minRows, refresh():ParsedRow[] }
const SOURCES = {
  asp: {
    cadence: "quarterly", effective: "2026-07-01", owned: ["asp", "dosage"], minRows: 400,
    refresh: async () => {
      const q = quarterCandidates();
      const slugs = q.flatMap((c) => [
        `${c.m}-${c.y}-medicare-part-b-payment-limit-files.zip`,
        `${c.m}-${c.y}-medicare-part-b-payment-limit-files-final-file.zip`,
        `${c.m}-${c.y}-medicare-part-b-payment-limit-files-preliminary.zip`,
        `${c.m}-${c.y}-asp-pricing-file.zip`,
      ]);
      const { buf } = await resolveZip({ slugs, pages: ["https://www.cms.gov/medicare/payment/part-b-drugs/asp-pricing-files"], include: ["payment-limit|asp"], exclude: ["crosswalk", "ndc"] });
      return rowsFromZip(buf).map((r) => ({ hcpcs: norm(pick(r, "hcpcs code", "hcpcs")), asp: str(pick(r, "payment limit", "limit")), dosage: str(pick(r, "dosage")) })).filter((r) => r.hcpcs);
    },
  },
  clfs: {
    cadence: "quarterly", effective: "2026-01-01", owned: ["clfs"], minRows: 800,
    refresh: async () => {
      const q = quarterCandidates();
      const slugs = q.flatMap((c) => [`${String(c.y).slice(2)}clabq${c.qn}.zip`, `${String(c.y).slice(2)}clab.zip`]);
      const { buf } = await resolveZip({ slugs, pages: ["https://www.cms.gov/medicare/payment/fee-schedules/clinical-laboratory-fee-schedule-clfs/files"], include: ["clab"] });
      // The CLFS PUF release ships csv/xlsx/txt that all carry a multi-row
      // title + AMA-copyright preamble BEFORE the real header row. Parse the CSV
      // text directly (quote-aware): find the header line containing HCPCS, then
      // read the HCPCS column and the payment-rate column.
      const splitCsv = (line) => {
        const o = []; let cur = "", q = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
          else if (ch === "," && !q) { o.push(cur); cur = ""; }
          else cur += ch;
        }
        o.push(cur); return o;
      };
      const csv = rawTextFromZip(buf, /\.csv$/i) || rawTextFromZip(buf, /\.txt$/i);
      const lines = csv.split(/\r?\n/);
      // The preamble is prose that can itself mention "HCPCS codes ...", so the
      // header row is the first one with a cell that IS the HCPCS header (a short
      // "hcpcs"/"hcpcs code(s)" cell), not merely a line containing the word.
      const norml = (h) => h.replace(/"/g, "").toLowerCase().replace(/\s+/g, " ").trim();
      let hi = -1, headers = null;
      for (let i = 0; i < Math.min(lines.length, 80); i++) {
        const cells = splitCsv(lines[i]).map(norml);
        if (cells.some((h) => /^hcpcs( code)?s?$/.test(h))) { hi = i; headers = cells; break; }
      }
      const out = [];
      let chosenHdr = null;
      if (hi >= 0) {
        const hc = headers.findIndex((h) => /^hcpcs( code)?s?$/.test(h));
        // Payment column: a rate/payment/fee/amount header (not a date, mod, or
        // the code column). Take the first such match.
        const pay = headers.findIndex((h) => /(payment|rate|fee|amount|price)/.test(h) && !/date|effective|hcpcs|mod/.test(h));
        chosenHdr = pay >= 0 ? headers[pay] : null;
        console.log(`    clfs headers (row ${hi}): ${JSON.stringify(headers)}`);
        if (hc >= 0 && pay >= 0) {
          for (const l of lines.slice(hi + 1)) {
            if (!l.trim()) continue;
            const cols = splitCsv(l);
            const code = norm((cols[hc] || "").replace(/"/g, ""));
            if (!/^[A-Z0-9]{5}$/.test(code)) continue;
            const amt = num((cols[pay] || "").replace(/"/g, ""));
            if (!(amt > 0)) continue;
            out.push({ hcpcs: code, clfs: amt.toFixed(2) });
          }
        }
      } else {
        // No header found — dump the first lines so the true layout is visible.
        console.log("    clfs: no HCPCS header; first lines: " + JSON.stringify(lines.slice(0, 12)));
      }
      console.log(`    clfs: ${out.length} rows${chosenHdr ? ` [pay col: "${chosenHdr}"]` : ""}`);
      if (out.length) console.log("    clfs sample: " + out.slice(0, 6).map((r) => `${r.hcpcs}=>${r.clfs}`).join(", "));
      return out;
    },
  },
  addendum_b: {
    // Addendum B carries per-HCPCS Status Indicator, short description AND the
    // OPPS payment rate, so it feeds apc_payment directly (no separate A join).
    cadence: "quarterly", effective: "2026-04-01", owned: ["si", "short_desc", "apc_payment"], minRows: 8000,
    refresh: async () => {
      const q = quarterCandidates();
      const slugs = q.flatMap((c) => [`${c.m}-${c.y}-opps-addendum-b.zip`, `${c.m}-${c.y}-addendum-b.zip`]);
      const { buf } = await resolveZip({
        slugs,
        pages: ["https://www.cms.gov/medicare/payment/prospective-payment-systems/hospital-outpatient-pps/quarterly-addenda-updates"],
        include: ["addendum.?b"], exclude: [],
      });
      return rowsFromZip(buf).map((r) => ({
        hcpcs: norm(pick(r, "hcpcs")),
        si: str(pick(r, "status indicator", "si")),
        short_desc: str(pick(r, "short desc", "descriptor")),
        apc_payment: str(pick(r, "payment rate", "payment")),
      })).filter((r) => r.hcpcs);
    },
  },
  mpfs: {
    // National fee = total RVUs x conversion factor, from the PPRRVU file.
    cadence: "quarterly", effective: "2026-01-01", owned: ["mc_fee", "pf_fee"], minRows: 5000,
    refresh: async () => {
      const q = quarterCandidates();
      // The RVU zip often carries a "-updated-MM-DD-YYYY" suffix, so scrape the
      // per-release detail page for the exact /files/zip/rvuNNx*.zip link; also
      // try the bare slug in case it's un-suffixed.
      const slugs = q.map((c) => `rvu${String(c.y).slice(2)}${c.letter.toLowerCase()}.zip`);
      const pages = q.map((c) => `https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files/rvu${String(c.y).slice(2)}${c.letter.toLowerCase()}`);
      pages.push("https://www.cms.gov/medicare/payment/fee-schedules/physician/pfs-relative-value-files");
      const { buf } = await resolveZip({ slugs, pages, include: ["rvu"], exclude: ["gpci", "oppscap"] });
      const tables = tablesFromZip(buf, "gpci|oppscap|anes|readme|layout|ndc|crosswalk");
      const t = pickTable(tables, { prefer: [/pprrvu.*nonqpp.*\.xlsx/i, /pprrvu.*\.xlsx/i, /pprrvu/i], avoid: [/gpci|oppscap|[^n]qpp/i], hints: ["hcpcs"] });
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
        const nonFac = num(r[C.nonfacTotal]) || (num(r[C.work]) + num(r[C.nonfacPE]) + num(r[C.mp]));
        const fac = num(r[C.facTotal]) || (num(r[C.work]) + num(r[C.facPE]) + num(r[C.mp]));
        const rec = { hcpcs: code };
        if (nonFac > 0) rec.mc_fee = (nonFac * cf).toFixed(2);
        if (fac > 0) rec.pf_fee = (fac * cf).toFixed(2);
        if (rec.mc_fee || rec.pf_fee) out.push(rec);
      }
      return out;
    },
  },
  hcpcs: {
    // Alpha-numeric HCPCS (ANWEB) file → retired-code flag from the termination
    // date / action code, so deleted codes get flagged for replacement.
    cadence: "quarterly", effective: "2026-04-01", owned: ["retired"], minRows: 5000,
    refresh: async () => {
      const q = quarterCandidates();
      const slugs = q.flatMap((c) => [`${c.m}-${c.y}-alpha-numeric-hcpcs-file.zip`, `${c.m}-${c.y}-alpha-numeric-hcpcs-files.zip`]);
      const { buf } = await resolveZip({ slugs, pages: ["https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system/quarterly-update"], include: ["hcpcs"], exclude: ["record", "layout"] });
      const rows = rowsFromZip(buf, "hcpc");
      const now = Date.now();
      const isPast = (v) => { if (!v) return false; const t = Date.parse(String(v)); return !isNaN(t) && t < now; };
      return rows.map((r) => {
        const code = norm(pick(r, "hcpc"));
        const term = pick(r, "termination date", "term date");
        const action = String(pick(r, "action code") || "").trim().toUpperCase();
        const retired = (isPast(term) || action === "D") ? "YES" : null;
        return { hcpcs: code, retired };
      }).filter((r) => r.hcpcs);
    },
  },
};

function nextRelease(cadence, from) {
  const y = from.getUTCFullYear();
  if (cadence === "annual") { const jan = Date.UTC(y, 0, 1); return new Date(from.getTime() >= jan ? Date.UTC(y + 1, 0, 1) : jan); }
  for (const m of [0, 3, 6, 9]) { const d = Date.UTC(y, m, 1); if (d > from.getTime()) return new Date(d); }
  return new Date(Date.UTC(y + 1, 0, 1));
}
const isDue = (s) => Date.now() >= nextRelease(s.cadence, new Date(s.effective + "T00:00:00Z")).getTime();

function validate(rows, minRows) {
  if (!rows?.length) return "no rows parsed";
  if (rows.length < minRows) return `only ${rows.length} rows (expected >= ${minRows}) - likely a format change`;
  if (rows.filter((r) => r.hcpcs).length / rows.length < 0.95) return ">5% of rows missing a HCPCS key";
  return null;
}

async function persist(key, owned, rows, vintage) {
  // A HCPCS can appear more than once in a CMS file; collapse to one row (last
  // wins) so the batch upsert doesn't hit "ON CONFLICT ... cannot affect row a
  // second time".
  const seen = new Map();
  for (const r of rows) if (r.hcpcs) seen.set(r.hcpcs, r);
  const uniq = [...seen.values()];
  let written = 0;
  for (let i = 0; i < uniq.length; i += 1000) {
    const batch = uniq.slice(i, i + 1000).map((r) => { const rec = { hcpcs: r.hcpcs }; for (const c of owned) rec[c] = r[c] ?? null; return rec; });
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
  try {
    const rows = await s.refresh(s);
    const bad = validate(rows, s.minRows);
    if (bad) throw new Error(bad);
    const n = await persist(key, s.owned, rows, String(new Date().getUTCFullYear()));
    console.log(`  ${key}: refreshed ${n} rows`);
  } catch (e) {
    failures++;
    console.error(`  ${key}: FAILED - ${e.message}`);
    try { await db.from("cms_reference_sources").upsert({ key, status: "error", last_error: e.message, last_checked: new Date().toISOString() }, { onConflict: "key" }); } catch {}
  }
}
process.exit(failures ? 1 : 0);
