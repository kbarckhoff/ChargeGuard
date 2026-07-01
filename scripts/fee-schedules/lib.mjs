// Shared helpers for the fee-schedule refresh pipeline.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import https from "node:https";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";

export const ROOT = process.cwd();
export const STAGING_DIR = join(ROOT, "data", "cms-sources", "staging");
export const LIVE_DIR = join(ROOT, "data", "cms-sources", "live");
export const MANIFEST_PATH = join(ROOT, "data", "cms-sources", "manifest.json");

// ── HCPCS normalization (must match src/lib/cms-reference.ts) ──
export function normalizeHcpcs(raw) {
  if (raw == null) return "";
  let s = String(raw).trim().toUpperCase();
  if (!s) return "";
  s = s.replace(/\.0+$/, "");
  if (/^\d+$/.test(s)) return s.padStart(5, "0");
  const m = s.match(/^([A-Z])(\d+)$/);
  if (m) return m[1] + m[2].padStart(4, "0");
  return s;
}

// ── HTTP (follows redirects) ──
export function httpGet(url, asText = false, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error("Too many redirects: " + url));
    https
      .get(url, { headers: { "User-Agent": "ChargeGuard-FeeScheduleBot/1.0" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          return resolve(httpGet(next, asText, redirects + 1));
        }
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve(asText ? buf.toString("utf8") : buf);
        });
      })
      .on("error", reject);
  });
}

// ── Discover the newest quarterly file link on a CMS landing page ──
// Returns { label, pageUrl }. CMS nests the actual ZIP one page deeper, so the
// caller may need to fetch pageUrl and extract the ZIP href (extractZipHref).
export async function discoverLatestLink(source) {
  const html = await httpGet(source.landingUrl, true);
  const anchorRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const candidates = [];
  let m;
  while ((m = anchorRe.exec(html))) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const match = (source.linkMatcher && (source.linkMatcher.test(text) || source.linkMatcher.test(href)));
    if (!match) continue;
    const q = quarterRank(text + " " + href);
    if (q) candidates.push({ label: text, pageUrl: new URL(href, source.landingUrl).toString(), rank: q });
  }
  candidates.sort((a, b) => b.rank - a.rank);
  return candidates[0] || null;
}

// Rank "Month YYYY" so the newest sorts first. Returns year*100 + monthOrder.
const MONTHS = { january: 1, april: 2, july: 3, october: 4 };
export function quarterRank(s) {
  const t = String(s).toLowerCase();
  let m = t.match(/(january|april|july|october)\D{0,8}(\d{4})/); // "April 2026"
  if (m) return parseInt(m[2]) * 10 + MONTHS[m[1]];
  m = t.match(/rvu(\d{2})([a-d])/);                              // RVU26A → 2026 #1, RVU26B → #2
  if (m) return (2000 + parseInt(m[1])) * 10 + (m[2].charCodeAt(0) - 96);
  m = t.match(/(\d{2})clab\D*q?(\d)/);                           // 26CLABQ1 → 2026 #1
  if (m) return (2000 + parseInt(m[1])) * 10 + parseInt(m[2]);
  m = t.match(/\b(20\d{2})\D{0,4}q(\d)\b/);                      // generic "2026 Q1"
  if (m) return parseInt(m[1]) * 10 + parseInt(m[2]);
  return 0;
}
export function quarterLabel(rank) {
  if (!rank) return "?";
  const year = Math.floor(rank / 10);
  const ord = rank % 10;
  const mo = Object.entries(MONTHS).find(([, v]) => v === ord)?.[0];
  return mo ? `${mo[0].toUpperCase()}${mo.slice(1)} ${year}` : `${year} #${ord}`;
}

// Find the first .zip/.xlsx href on a (deeper) CMS file page.
export function extractFileHref(html, baseUrl, exts = [".zip", ".xlsx", ".xls", ".csv", ".txt"]) {
  const anchorRe = /<a[^>]+href="([^"]+)"/gi;
  let m;
  while ((m = anchorRe.exec(html))) {
    const href = m[1];
    if (exts.some((e) => href.toLowerCase().split("?")[0].endsWith(e))) {
      return new URL(href, baseUrl).toString();
    }
  }
  // Fallback for JS-rendered CMS pages: the file URL is embedded in a script/JSON
  // blob rather than an <a> tag. Scan the raw source for a /files/... download.
  const raw = html.match(/(?:https:\/\/www\.cms\.gov)?\/files\/(?:zip|document)\/[^"'\s\\)]+\.(?:zip|xlsx?|csv)/i);
  if (raw) return new URL(raw[0], baseUrl).toString();
  return null;
}

// ── Turn a downloaded buffer (zip or spreadsheet) into rows (array of arrays) ──
// Returns { entries: [{name, rows}] } so a parser can pick the right sheet/file.
export function bufferToTables(buf, filename = "") {
  const lower = filename.toLowerCase();
  const tables = [];
  if (lower.endsWith(".zip") || (buf[0] === 0x50 && buf[1] === 0x4b && !lower.match(/\.xlsx?$/))) {
    const zip = new AdmZip(buf);
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      const sub = bufferToTables(e.getData(), e.entryName);
      sub.forEach((t) => tables.push({ name: e.entryName + (t.name ? `:${t.name}` : ""), rows: t.rows }));
    }
    return tables;
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || (buf[0] === 0x50 && buf[1] === 0x4b)) {
    const wb = XLSX.read(buf, { type: "buffer" });
    for (const sheet of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: "" });
      tables.push({ name: sheet, rows });
    }
    return tables;
  }
  // csv / txt — split lines, comma or pipe or tab delimited (best-effort)
  const text = buf.toString("utf8");
  const delim = text.includes("|") ? "|" : text.includes("\t") ? "\t" : ",";
  const rows = text.split(/\r?\n/).filter(Boolean).map((l) => l.split(delim));
  tables.push({ name: filename || "text", rows });
  return tables;
}

// ── Manifest (version tracking) ──
export function readManifest() {
  if (!existsSync(MANIFEST_PATH)) return { sources: {} };
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}
export function writeManifest(m) {
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
}
export function writeJson(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(obj));
}
export function readJsonIf(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}
