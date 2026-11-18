// ─── NCCI refresh (PTP + MUE, standalone, heavy files) ───────
// The NCCI Procedure-to-Procedure (PTP) outpatient-hospital edit file is ~1.7M
// code pairs — far too large to load through the in-app dev/serverless route
// without blocking the Node event loop or timing out. This script loads BOTH
// NCCI sources directly, with full memory, and is the production auto-update
// path (called by the quarterly GitHub Action; also runnable by hand):
//
//   node --max-old-space-size=4096 scripts/refresh-ncci.mjs            # both
//   ONLY=ptp node --max-old-space-size=4096 scripts/refresh-ncci.mjs   # one
//   ONLY=mue node scripts/refresh-ncci.mjs
//
// Env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.
// For manual runs it also self-loads these from .env.local.
//   PTP → ncci_ptp table (code pairs). MUE → cms_reference.mue / .mue_mai.
import { createClient } from "@supabase/supabase-js";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";
import fs from "node:fs";
import path from "node:path";

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in process.env)) process.env[m[1]] = v;
  }
}
loadEnvLocal();

const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
const db = createClient(URL, KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const UA = "Mozilla/5.0 (ChargeGuard reference refresher)";
const only = (process.env.ONLY || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
const want = (k) => !only.length || only.includes(k);

const PTP_LANDING = "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-procedure-procedure-ptp-edits";
const MUE_LANDING = "https://www.cms.gov/medicare/coding-billing/national-correct-coding-initiative-ncci-edits/medicare-ncci-medically-unlikely-edits";
const CHANGE = /addition|deletion|revision|\bchange/i;

const normHcpcs = (v) => {
  if (v == null) return "";
  let s = String(v).trim().toUpperCase().replace(/\.0+$/, "");
  if (/^\d+$/.test(s)) return s.padStart(5, "0");
  const m = s.match(/^([A-Z])(\d+)$/);
  return m ? m[1] + m[2].padStart(4, "0") : s;
};
const qLabel = (url) => {
  const qm = String(url).match(/(20\d\d)q([1-4])/i);
  return qm ? `${qm[1]} Q${qm[2]}` : (String(url).match(/20\d\d/g)?.pop() || String(new Date().getUTCFullYear()));
};

// Resolve a full hospital-outpatient zip (exclude practitioner + change files;
// unwrap CMS "?file=" AMA-license links).
async function resolveZipUrl(landing) {
  const html = await (await fetch(landing, { headers: { "User-Agent": UA } })).text();
  const urls = new Set();
  for (const m of html.matchAll(/(?:href|file)=["']?([^"'&> ]*\/files\/zip\/[^"'&> ]+\.zip)/gi)) {
    let u = m[1];
    if (u.includes("file=")) u = decodeURIComponent(u.split("file=").pop());
    urls.add(u.startsWith("http") ? u : `https://www.cms.gov${u}`);
  }
  const all = [...urls];
  let pool = all.filter((u) => /ccioph|hospital|outpatient/i.test(u) && !/ccipra|practitioner/i.test(u) && !CHANGE.test(u));
  if (!pool.length) pool = all.filter((u) => !CHANGE.test(u));
  if (!pool.length) throw new Error(`no zip link on CMS page (found: ${all.slice(0, 5).join(", ") || "none"})`);
  pool.sort((a, b) => ((b.match(/20\d\d/g)?.pop() || "").localeCompare(a.match(/20\d\d/g)?.pop() || "")) || (a.length - b.length));
  return pool[0];
}
async function fetchZip(url) {
  const resp = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!(buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b)) throw new Error(`not a zip (status=${resp.status} bytes=${buf.length})`);
  return buf;
}
function readTable(buf) {
  const zip = new AdmZip(buf);
  const entries = zip.getEntries().filter((e) => /\.(xlsx|xls|csv|txt)$/i.test(e.entryName) && !CHANGE.test(e.entryName));
  if (!entries.length) throw new Error("no data file inside the zip");
  const entry = entries.sort((a, b) => b.getData().length - a.getData().length)[0];
  const wb = XLSX.read(entry.getData(), { type: "buffer", raw: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
  const HDR = /^(hcpcs|cpt|hcpcs\/?cpt|column\s*1|column\s*2|modifier|effective|deletion|mue|adjudication|rationale|units)/i;
  const headerish = (c) => { const s = String(c ?? "").trim(); return s.length > 0 && s.length < 40 && HDR.test(s); };
  let hi = grid.findIndex((r) => r.filter(headerish).length >= 2);
  if (hi < 0) hi = grid.findIndex((r) => r.some(headerish));
  if (hi < 0) hi = 0;
  return { headers: grid[hi].map((c) => String(c ?? "")), grid: grid.slice(hi + 1), entry: entry.entryName };
}

// ── PTP → one row per pair (current definition) → ncci_ptp ──
async function refreshPtp() {
  const t0 = Date.now();
  const zipUrl = await resolveZipUrl(PTP_LANDING);
  console.log(`  PTP url: ${zipUrl}`);
  const buf = await fetchZip(zipUrl);
  const { headers, grid, entry } = readTable(buf);
  const find = (re) => headers.findIndex((h) => re.test(h));
  let i1 = find(/column\s*1/i), i2 = find(/column\s*2/i);
  let im = find(/modifier/i), ie = find(/effective/i), id = find(/deletion/i);
  if (i1 < 0 || i2 < 0 || i1 === i2) {
    const sample = grid.slice(0, 50).filter((r) => normHcpcs(String(r[0] ?? "")) && normHcpcs(String(r[1] ?? "")));
    if (!sample.length) throw new Error(`PTP: could not locate code columns (entry=${entry})`);
    i1 = 0; i2 = 1;
    const width = Math.max(...sample.map((r) => r.length));
    im = -1;
    for (let c = 2; c < width; c++) { if (sample.every((r) => /^[019]$/.test(String(r[c] ?? "").trim()))) { im = c; break; } }
    const dc = [];
    for (let c = 2; c < width; c++) { if (sample.some((r) => /\d{8}|\d{1,2}\/\d{1,2}\/\d{2,4}/.test(String(r[c] ?? "").trim()))) dc.push(c); }
    ie = dc[0] ?? -1; id = dc[1] ?? -1;
  }
  const byPair = new Map();
  const score = (r) => (r.deletion ? 0 : 100000000000) + (parseInt(String(r.effective ?? "").replace(/\D/g, "").slice(0, 8), 10) || 0);
  for (const r of grid) {
    const c1 = normHcpcs(String(r[i1] ?? "")), c2 = normHcpcs(String(r[i2] ?? ""));
    if (!c1 || !c2) continue;
    const delRaw = id >= 0 ? String(r[id] ?? "").trim() : "";
    const row = {
      col1: c1, col2: c2,
      modifier_indicator: im >= 0 ? (String(r[im] ?? "").trim().slice(0, 1) || null) : null,
      effective: ie >= 0 ? (r[ie] == null ? null : String(r[ie])) : null,
      deletion: delRaw && !/^\*+$/.test(delRaw) ? delRaw : null,
    };
    const key = `${c1}|${c2}`;
    const prev = byPair.get(key);
    if (!prev || score(row) > score(prev)) byPair.set(key, row);
  }
  const rows = [...byPair.values()];
  console.log(`  PTP entry=${entry} → ${rows.length.toLocaleString()} unique pairs`);
  if (rows.length < 50000) throw new Error(`PTP: only ${rows.length} pairs — likely a layout change`);
  await db.from("ncci_ptp").delete().neq("id", 0);
  let written = 0;
  for (let i = 0; i < rows.length; i += 5000) {
    const slice = rows.slice(i, i + 5000);
    const { error } = await db.from("ncci_ptp").upsert(slice, { onConflict: "col1,col2", ignoreDuplicates: true });
    if (error) throw new Error(`PTP insert @${i}: ${error.message}`);
    written += slice.length;
  }
  const vintage = qLabel(zipUrl);
  await db.from("cms_reference_sources").upsert(
    { key: "ncci_ptp", vintage, source_url: zipUrl, status: "ok", row_count: written, last_refreshed: new Date().toISOString(), last_checked: new Date().toISOString(), last_error: null },
    { onConflict: "key" }
  );
  console.log(`  ✅ ncci_ptp: ${written.toLocaleString()} pairs, vintage="${vintage}" in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

// ── MUE → per-HCPCS unit caps → cms_reference.mue / .mue_mai ──
async function refreshMue() {
  const t0 = Date.now();
  const zipUrl = await resolveZipUrl(MUE_LANDING);
  console.log(`  MUE url: ${zipUrl}`);
  const buf = await fetchZip(zipUrl);
  const { headers, grid, entry } = readTable(buf);
  const col = (needle) => headers.findIndex((h) => h.toLowerCase().includes(needle));
  const ic = col("hcpcs") >= 0 ? col("hcpcs") : col("cpt");
  const iv = headers.findIndex((h) => /mue value|mue values|units/i.test(h));
  const im = headers.findIndex((h) => /adjudication|\bmai\b/i.test(h));
  if (ic < 0 || iv < 0) throw new Error(`MUE: columns not found (entry=${entry} headers=${JSON.stringify(headers.slice(0, 8))})`);
  const seen = new Map();
  for (const r of grid) {
    const code = normHcpcs(String(r[ic] ?? ""));
    if (!code) continue;
    const v = parseInt(String(r[iv] ?? "").replace(/[^\d-]/g, ""), 10);
    seen.set(code, { hcpcs: code, mue: Number.isFinite(v) ? v : null, mue_mai: im >= 0 ? (r[im] == null ? null : String(r[im])) : null });
  }
  const rows = [...seen.values()];
  console.log(`  MUE entry=${entry} → ${rows.length.toLocaleString()} codes`);
  if (rows.length < 2000) throw new Error(`MUE: only ${rows.length} codes — likely a layout change`);
  let written = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const slice = rows.slice(i, i + 1000);
    const { error } = await db.from("cms_reference").upsert(slice, { onConflict: "hcpcs" });
    if (error) throw new Error(`MUE upsert @${i}: ${error.message}`);
    written += slice.length;
  }
  const vintage = qLabel(zipUrl);
  await db.from("cms_reference_sources").upsert(
    { key: "ncci_mue", vintage, source_url: zipUrl, status: "ok", row_count: written, last_refreshed: new Date().toISOString(), last_checked: new Date().toISOString(), last_error: null },
    { onConflict: "key" }
  );
  console.log(`  ✅ ncci_mue: ${written.toLocaleString()} codes, vintage="${vintage}" in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

let failures = 0;
for (const [key, fn] of [["ptp", refreshPtp], ["mue", refreshMue]]) {
  if (!want(key)) continue;
  try { await fn(); }
  catch (e) {
    failures++;
    const msg = e?.message || String(e);
    console.error(`  ❌ ncci_${key} FAILED: ${msg}`);
    try { await db.from("cms_reference_sources").upsert({ key: `ncci_${key}`, status: "error", last_error: msg, last_checked: new Date().toISOString() }, { onConflict: "key" }); } catch {}
  }
}
process.exit(failures ? 1 : 0);
