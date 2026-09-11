// ─── 837 / Claims Parser ─────────────────────────────────────
// Parses an X12 837 claims file (Professional 837P via SV1, or Institutional
// 837I via SV2) OR a claim-line CSV into normalized claim service lines the
// engine's claims rules run over. Framework-free so it runs in the browser
// (import component) and in Node (tests).

export interface ClaimLine {
  claim_id: string | null;
  patient_acct: string | null;
  rev_code: string | null;
  hcpcs: string | null;
  mod1: string | null;
  mod2: string | null;
  mod3: string | null;
  mod4: string | null;
  units: number | null;
  line_charge: number | null;
  service_date: string | null;
  pos: string | null;
  dx_primary: string | null;
}

export interface ParseResult {
  rows: ClaimLine[];
  format: "837" | "csv" | "unknown";
  meta: { claims: number; lines: number; note?: string };
}

const numOrNull = (v: any): number | null => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
};
const clean = (v: any): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

// Is this an X12 837 file? (starts with ISA, or clearly has claim/service segments)
function is837(text: string): boolean {
  const head = text.slice(0, 200).toUpperCase();
  if (head.startsWith("ISA")) return true;
  return /(^|[~\n])\s*(CLM|ST\*837|SV1|SV2)[\*|]/.test(text.slice(0, 4000));
}

// Detect X12 delimiters. Defaults are element "*", component ":", segment "~".
function detectSeparators(text: string) {
  let element = "*", component = ":", segment = "~";
  const isaIdx = text.indexOf("ISA");
  if (isaIdx >= 0 && text.length >= isaIdx + 106) {
    element = text[isaIdx + 3] || element;      // ISA is fixed-width; el sep at pos 3
    component = text[isaIdx + 104] || component; // ISA16 component sep
    segment = text[isaIdx + 105] || segment;     // segment terminator
  }
  return { element, component, segment };
}

export function parse837(text: string): ParseResult {
  const { element, component, segment } = detectSeparators(text);
  const segs = text
    .split(segment)
    .map((s) => s.replace(/[\r\n]+/g, "").trim())
    .filter(Boolean)
    .map((s) => s.split(element));

  const rows: ClaimLine[] = [];
  const claimIds = new Set<string>();

  let claimId: string | null = null;
  let pos: string | null = null;
  let dxPrimary: string | null = null;
  let pending: ClaimLine | null = null;

  const flush = () => { if (pending) { rows.push(pending); pending = null; } };

  const parseComposite = (v: string | undefined) => (v ? v.split(component) : []);

  for (const seg of segs) {
    const tag = (seg[0] || "").toUpperCase();

    if (tag === "CLM") {
      flush();
      claimId = clean(seg[1]);
      if (claimId) claimIds.add(claimId);
      // CLM05 = "POS:facilityQualifier:frequency"
      const clm05 = parseComposite(seg[5]);
      pos = clean(clm05[0]);
      dxPrimary = null;
    } else if (tag === "HI") {
      // Diagnosis segment: each element is "qualifier:code". Principal = ABK/BK.
      for (let i = 1; i < seg.length; i++) {
        const comp = parseComposite(seg[i]);
        const q = (comp[0] || "").toUpperCase();
        if ((q === "ABK" || q === "BK") && !dxPrimary) dxPrimary = clean(comp[1]);
      }
    } else if (tag === "LX") {
      flush();
    } else if (tag === "SV1" || tag === "SV2") {
      flush();
      let hcpcs: string | null = null, mods: string[] = [], revCode: string | null = null;
      let charge: number | null = null, units: number | null = null, linePos: string | null = null;
      if (tag === "SV1") {
        // SV1-01 = HC:hcpcs:mod1:mod2:mod3:mod4 ; -02 charge ; -04 units ; -05 POS
        const comp = parseComposite(seg[1]);
        hcpcs = clean(comp[1]);
        mods = comp.slice(2).map((m) => clean(m)).filter(Boolean) as string[];
        charge = numOrNull(seg[2]);
        units = numOrNull(seg[4]);
        linePos = clean(seg[5]);
      } else {
        // SV2-01 = revenue code ; -02 = HC:hcpcs:mods ; -03 charge ; -05 units
        revCode = clean(seg[1]);
        const comp = parseComposite(seg[2]);
        hcpcs = clean(comp[1]);
        mods = comp.slice(2).map((m) => clean(m)).filter(Boolean) as string[];
        charge = numOrNull(seg[3]);
        units = numOrNull(seg[5]);
      }
      pending = {
        claim_id: claimId, patient_acct: claimId, rev_code: revCode, hcpcs,
        mod1: mods[0] || null, mod2: mods[1] || null, mod3: mods[2] || null, mod4: mods[3] || null,
        units, line_charge: charge, service_date: null, pos: linePos || pos, dx_primary: dxPrimary,
      };
    } else if (tag === "DTP" && (seg[1] === "472" || seg[1] === "471")) {
      // Service date; attach to the current line if not already set.
      const d = clean(seg[3]);
      if (pending && !pending.service_date) pending.service_date = d;
    }
  }
  flush();

  return { rows, format: "837", meta: { claims: claimIds.size, lines: rows.length } };
}

// ── CSV fallback (quote-aware) with flexible header mapping ──
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
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

export function parseClaimsCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], format: "csv", meta: { claims: 0, lines: 0, note: "empty" } };
  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[\s_]/g, ""));
  const idx = (...hints: string[]) => {
    for (const h of hints) { const i = headers.findIndex((c) => c.includes(h)); if (i >= 0) return i; }
    return -1;
  };
  const ix = {
    claim: idx("claimid", "claim", "clm", "patientcontrol"),
    acct: idx("patientacct", "account", "acct"),
    rev: idx("revcode", "revenuecode", "rev"),
    hcpcs: idx("hcpcs", "cpt", "procedure", "code"),
    m1: idx("modifier1", "mod1", "modifier"),
    m2: idx("modifier2", "mod2"),
    m3: idx("modifier3", "mod3"),
    m4: idx("modifier4", "mod4"),
    units: idx("units", "unit", "qty"),
    charge: idx("linecharge", "charge", "billed", "amount"),
    date: idx("servicedate", "dos", "date"),
    pos: idx("placeofservice", "pos"),
    dx: idx("diagnosis", "dx", "icd"),
  };
  const rows: ClaimLine[] = [];
  const claimIds = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const get = (j: number) => (j >= 0 ? clean(c[j]) : null);
    const cid = get(ix.claim);
    if (cid) claimIds.add(cid);
    const hcpcs = get(ix.hcpcs);
    if (!hcpcs && ix.rev < 0) continue;
    rows.push({
      claim_id: cid, patient_acct: get(ix.acct) || cid, rev_code: get(ix.rev), hcpcs,
      mod1: get(ix.m1), mod2: get(ix.m2), mod3: get(ix.m3), mod4: get(ix.m4),
      units: numOrNull(ix.units >= 0 ? c[ix.units] : null),
      line_charge: numOrNull(ix.charge >= 0 ? c[ix.charge] : null),
      service_date: get(ix.date), pos: get(ix.pos), dx_primary: get(ix.dx),
    });
  }
  return { rows, format: "csv", meta: { claims: claimIds.size, lines: rows.length } };
}

export function parseClaims(text: string): ParseResult {
  if (!text || !text.trim()) return { rows: [], format: "unknown", meta: { claims: 0, lines: 0, note: "empty file" } };
  return is837(text) ? parse837(text) : parseClaimsCsv(text);
}
