// Per-source parsers. Each takes the raw tables (from bufferToTables) and returns
// { data: { [normHcpcs]: { ...feedColumns } }, activeCodes?: [], meta }.
//
// Column detection is by HEADER NAME (case-insensitive substring), resilient to
// CMS reordering columns. Run `refresh --inspect` to see detected sheet/headers.
import { normalizeHcpcs } from "./lib.mjs";

// A header row = first row with >=2 SHORT cells (<=40 chars) matching the hints.
// The short-cell rule avoids matching CMS "notice" paragraphs that happen to
// contain words like "hcpcs"/"payment".
function findHeader(rows, hints) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map((c) => String(c));
    const shortLower = cells.filter((c) => c.length <= 40).map((c) => c.toLowerCase());
    const hits = hints.filter((h) => shortLower.some((c) => c.includes(h))).length;
    if (hits >= 2) return i;
  }
  return -1;
}
const num = (v) => { const n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; };
function colIndex(headerRow, ...hints) {
  for (const hint of hints) {
    const i = headerRow.findIndex((c) => String(c).toLowerCase().includes(hint));
    if (i >= 0) return i;
  }
  return -1;
}
// pick the best table by name preference (prefer/avoid regexes), else first with a header
function pickTable(tables, { prefer = [], avoid = [], hints = [] }) {
  for (const re of prefer) {
    const t = tables.find((t) => re.test(t.name) && !avoid.some((a) => a.test(t.name)));
    if (t) return t;
  }
  const t = tables.find((t) => !avoid.some((a) => a.test(t.name)) && findHeader(t.rows, hints) >= 0);
  return t || tables[0];
}

export function addendumB(tables, { inspect } = {}) {
  const t = pickTable(tables, {
    prefer: [/addendum\s*b/i],
    avoid: [/addendum\s*a/i],
    hints: ["hcpcs", "status", "apc"],
  });
  const hi = findHeader(t.rows, ["hcpcs", "status indicator", "apc", "si"]);
  if (inspect) return { inspect: { sheet: t.name, headerRowIndex: hi, header: (t.rows[hi] || []).filter((c) => c !== "") } };
  const h = t.rows[hi] || [];
  const ix = {
    hcpcs: colIndex(h, "hcpcs"),
    si: colIndex(h, "si", "status indicator", "status"),
    rate: colIndex(h, "payment rate", "payment", "rate"),
    desc: colIndex(h, "short desc", "short", "descriptor"),
  };
  const data = {};
  for (const r of t.rows.slice(hi + 1)) {
    const code = normalizeHcpcs(r[ix.hcpcs]);
    if (!code) continue;
    const rec = {};
    if (ix.si >= 0 && r[ix.si] !== "") rec.si = String(r[ix.si]).trim();
    if (ix.rate >= 0 && r[ix.rate] !== "") rec.apc_payment = String(r[ix.rate]).trim();
    if (ix.desc >= 0 && r[ix.desc] !== "") rec.short_desc = String(r[ix.desc]).trim();
    data[code] = rec;
  }
  return { data, meta: { sheet: t.name, columns: ix, rows: Object.keys(data).length } };
}

export function aspPricing(tables, { inspect } = {}) {
  const t = pickTable(tables, {
    prefer: [/payment limit file.*asp_byhcpcs/i, /asp_byhcpcs/i, /payment limit file/i],
    avoid: [/not payable/i],
    hints: ["hcpcs", "payment limit", "limit"],
  });
  const hi = findHeader(t.rows, ["hcpcs", "payment limit", "limit", "short desc"]);
  if (inspect) return { inspect: { sheet: t.name, headerRowIndex: hi, header: (t.rows[hi] || []).filter((c) => c !== "") } };
  const h = t.rows[hi] || [];
  const ix = {
    hcpcs: colIndex(h, "hcpcs code", "hcpcs", "code"),
    limit: colIndex(h, "payment limit", "limit", "payment"),
    desc: colIndex(h, "short desc", "short", "description"),
    dosage: colIndex(h, "dosage"),
  };
  const data = {};
  for (const r of t.rows.slice(hi + 1)) {
    const code = normalizeHcpcs(r[ix.hcpcs]);
    if (!code || ix.limit < 0 || r[ix.limit] === "") continue;
    const rec = { asp: String(r[ix.limit]).trim() };
    if (ix.desc >= 0 && r[ix.desc] !== "") rec.short_desc = String(r[ix.desc]).trim();
    if (ix.dosage >= 0 && r[ix.dosage] !== "") rec.dosage = String(r[ix.dosage]).trim();
    data[code] = rec;
  }
  return { data, meta: { sheet: t.name, columns: ix, rows: Object.keys(data).length } };
}

export function hcpcsList(tables, { inspect } = {}) {
  // Use the main alpha-numeric file (ANWEB ...contr sheet), not the fixed-width
  // .txt, corrections, transaction report, NOC, or record-layout entries.
  const t = pickTable(tables, {
    prefer: [/anweb.*contr/i, /anweb_\d.*\.xlsx/i],
    avoid: [/correction|transaction|recordlayout|noc|proc[_ ]?notes|508|\.txt:/i],
    hints: ["hcpcs", "code", "description"],
  });
  const hi = findHeader(t.rows, ["hcpcs", "code", "description", "long desc", "short desc"]);
  if (inspect) return { inspect: { sheet: t.name, headerRowIndex: hi, header: (t.rows[hi] || []).filter((c) => c !== "") } };
  const h = t.rows[hi] || [];
  const ix = {
    hcpcs: colIndex(h, "hcpcs", "hcpc", "code"),
    desc: colIndex(h, "long desc", "long", "short desc", "short", "description"),
  };
  const data = {};
  const active = [];
  for (const r of t.rows.slice(hi + 1)) {
    const code = normalizeHcpcs(r[ix.hcpcs >= 0 ? ix.hcpcs : 0]);
    if (!code) continue;
    active.push(code);
    const rec = {};
    if (ix.desc >= 0 && r[ix.desc] !== "") rec.short_desc = String(r[ix.desc]).trim();
    data[code] = rec;
  }
  return { data, activeCodes: active, meta: { sheet: t.name, columns: ix, rows: active.length } };
}

export function mpfsRvu(tables, { inspect, source } = {}) {
  const cf = source?.conversionFactor || 0;
  // Use the clean .xlsx, the nonQPP variant (matches the standard $33.40 CF), not GPCI/OPPSCAP/QPP.
  const t = pickTable(tables, {
    prefer: [/pprrvu.*nonqpp.*\.xlsx/i, /pprrvu.*\.xlsx/i, /pprrvu/i],
    avoid: [/gpci|oppscap|narrative|readme|layout|[^n]qpp/i],
    hints: ["hcpcs"],
  });
  // PPRRVU uses a 4-row stacked header; the label row has "HCPCS" in column 0,
  // and the layout is fixed by position (data starts on the next row).
  const hi = t.rows.findIndex((r) => String(r[0]).trim().toUpperCase() === "HCPCS");
  if (inspect) return { inspect: { sheet: t.name, hcpcsLabelRow: hi, conversionFactor: cf, firstRows: t.rows.slice(0, 12).map((r) => r.slice(0, 14)) } };
  if (hi < 0) return { data: {}, meta: { sheet: t.name, rows: 0, note: "HCPCS label row not found" } };
  // Standard PPRRVU column positions (0-based):
  const C = { hcpcs: 0, mod: 1, status: 3, work: 5, nonfacPE: 6, facPE: 8, mp: 10, nonfacTotal: 11, facTotal: 12 };
  const data = {};
  for (const r of t.rows.slice(hi + 1)) {
    if (String(r[C.mod] ?? "").trim() !== "") continue; // base code only (skip 26/TC modifier rows)
    const code = normalizeHcpcs(r[C.hcpcs]);
    if (!code || !/^[A-Z0-9]{5}$/.test(code)) continue;
    const nonFac = num(r[C.nonfacTotal]) || num(r[C.work]) + num(r[C.nonfacPE]) + num(r[C.mp]);
    const fac = num(r[C.facTotal]) || num(r[C.work]) + num(r[C.facPE]) + num(r[C.mp]);
    const rec = {};
    if (cf > 0 && nonFac > 0) rec.mc_fee = (nonFac * cf).toFixed(2);
    if (cf > 0 && fac > 0) rec.pf_fee = (fac * cf).toFixed(2);
    if (Object.keys(rec).length) data[code] = rec;
  }
  return { data, meta: { sheet: t.name, hcpcsLabelRow: hi, conversionFactor: cf, rows: Object.keys(data).length } };
}

export function clfsRate(tables, { inspect } = {}) {
  const t = pickTable(tables, {
    prefer: [/clab|clfs/i],
    avoid: [/gap|crosswalk|narrative|readme|layout/i],
    hints: ["hcpcs", "rate", "payment", "fee", "amount"],
  });
  const hi = findHeader(t.rows, ["hcpcs", "rate", "payment", "fee", "amount"]);
  if (inspect) return { inspect: { sheet: t.name, headerRowIndex: hi, header: (t.rows[hi] || []).filter((c) => c !== "") } };
  const h = t.rows[hi] || [];
  const ix = { hcpcs: colIndex(h, "hcpcs", "code"), rate: colIndex(h, "payment", "rate", "fee", "amount") };
  const data = {};
  for (const r of t.rows.slice(hi + 1)) {
    const code = normalizeHcpcs(r[ix.hcpcs]);
    if (!code || ix.rate < 0 || r[ix.rate] === "") continue;
    data[code] = { clfs: String(r[ix.rate]).trim() };
  }
  return { data, meta: { sheet: t.name, columns: ix, rows: Object.keys(data).length } };
}

export const PARSERS = { addendumB, aspPricing, hcpcsList, mpfsRvu, clfsRate };
