// ─── 835 / Remittance Parser (Phase B) ───────────────────────
// Parses an X12 835 electronic remittance advice (ERA) OR a remit CSV into
// normalized claim-level and line-level adjudication records. The engine's
// cross-file joins use these to compute first-pass yield, denial rate, net
// collection yield, and the denial → claim → CDM root-cause trace.
// Framework-free so it runs in the browser (import component) and in Node.

export interface RemitAdjustment {
  group: string;        // CAS01 group code: CO / PR / OA / PI / CR
  carc: string;         // Claim Adjustment Reason Code (e.g. "197", "45", "16")
  amount: number;       // adjustment amount
}

export interface RemitClaim {
  claim_id: string | null;       // CLP01 patient control number (de-identified)
  status: string | null;        // CLP02 claim status (1 paid, 4 denied, …)
  total_charge: number | null;  // CLP03 submitted
  total_paid: number | null;    // CLP04 paid
  patient_resp: number | null;  // CLP05 patient responsibility
  payer_control: string | null; // CLP07 payer claim control number
  adjustments: RemitAdjustment[]; // claim-level CAS
}

export interface RemitLine {
  claim_id: string | null;      // parent CLP01
  hcpcs: string | null;         // SVC01 procedure
  mod1: string | null;
  rev_code: string | null;      // SVC04 (NUBC rev code, institutional)
  line_charge: number | null;   // SVC02 submitted
  line_paid: number | null;     // SVC03 paid
  units: number | null;         // SVC05
  adjustments: RemitAdjustment[]; // line-level CAS
}

export interface RemitParseResult {
  claims: RemitClaim[];
  lines: RemitLine[];
  format: "835" | "csv" | "unknown";
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

function is835(text: string): boolean {
  const head = text.slice(0, 400).toUpperCase();
  if (/ST\*835/.test(head)) return true;
  if (head.startsWith("ISA") && /[~\n]\s*(CLP|SVC|BPR)[\*|]/.test(text.slice(0, 6000))) return true;
  return /(^|[~\n])\s*CLP[\*|]/.test(text.slice(0, 6000));
}

function detectSeparators(text: string) {
  let element = "*", component = ":", segment = "~";
  const isaIdx = text.indexOf("ISA");
  if (isaIdx >= 0 && text.length >= isaIdx + 106) {
    element = text[isaIdx + 3] || element;
    component = text[isaIdx + 104] || component;
    segment = text[isaIdx + 105] || segment;
  }
  return { element, component, segment };
}

// CAS segment → adjustment triplets. CAS01 = group code, then repeating
// (reason, amount, quantity) triplets from element 2 onward.
function parseCas(seg: string[]): RemitAdjustment[] {
  const group = (seg[1] || "").toUpperCase();
  const out: RemitAdjustment[] = [];
  for (let i = 2; i < seg.length; i += 3) {
    const carc = clean(seg[i]);
    const amount = numOrNull(seg[i + 1]);
    if (carc && amount != null) out.push({ group, carc, amount });
  }
  return out;
}

export function parse835(text: string): RemitParseResult {
  const { element, component, segment } = detectSeparators(text);
  const segs = text
    .split(segment)
    .map((s) => s.replace(/[\r\n]+/g, "").trim())
    .filter(Boolean)
    .map((s) => s.split(element));

  const claims: RemitClaim[] = [];
  const lines: RemitLine[] = [];
  const parseComposite = (v: string | undefined) => (v ? v.split(component) : []);

  let curClaim: RemitClaim | null = null;
  let curLine: RemitLine | null = null;
  // CAS after an SVC attaches to the line; CAS after CLP (before any SVC)
  // attaches to the claim.
  let inLine = false;

  const flushLine = () => { if (curLine) { lines.push(curLine); curLine = null; } inLine = false; };
  const flushClaim = () => { flushLine(); if (curClaim) { claims.push(curClaim); curClaim = null; } };

  for (const seg of segs) {
    const tag = (seg[0] || "").toUpperCase();
    if (tag === "CLP") {
      flushClaim();
      curClaim = {
        claim_id: clean(seg[1]),
        status: clean(seg[2]),
        total_charge: numOrNull(seg[3]),
        total_paid: numOrNull(seg[4]),
        patient_resp: numOrNull(seg[5]),
        payer_control: clean(seg[7]),
        adjustments: [],
      };
    } else if (tag === "SVC") {
      flushLine();
      const comp = parseComposite(seg[1]);
      // SVC01 = HC:hcpcs:mod1:... (first element is the qualifier)
      const hcpcs = clean(comp[1]);
      const mod1 = clean(comp[2]);
      curLine = {
        claim_id: curClaim?.claim_id || null,
        hcpcs, mod1,
        rev_code: clean(seg[4]),
        line_charge: numOrNull(seg[2]),
        line_paid: numOrNull(seg[3]),
        units: numOrNull(seg[5]),
        adjustments: [],
      };
      inLine = true;
    } else if (tag === "CAS") {
      const adj = parseCas(seg);
      if (inLine && curLine) curLine.adjustments.push(...adj);
      else if (curClaim) curClaim.adjustments.push(...adj);
    }
  }
  flushClaim();

  return { claims, lines, format: "835", meta: { claims: claims.length, lines: lines.length } };
}

// ── CSV fallback: one row per adjudicated line, with optional CARC columns ──
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else { if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
  }
  out.push(cur);
  return out;
}

export function parseRemitCsv(text: string): RemitParseResult {
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim());
  if (rawLines.length < 2) return { claims: [], lines: [], format: "csv", meta: { claims: 0, lines: 0, note: "empty" } };
  const headers = splitCsvLine(rawLines[0]).map((h) => h.toLowerCase().replace(/[\s_]/g, ""));
  const idx = (...hints: string[]) => { for (const h of hints) { const i = headers.findIndex((c) => c.includes(h)); if (i >= 0) return i; } return -1; };
  const ix = {
    claim: idx("claimid", "claim", "clm", "patientcontrol"),
    hcpcs: idx("hcpcs", "cpt", "procedure", "code"),
    rev: idx("revcode", "rev"),
    charge: idx("linecharge", "charge", "billed", "submitted"),
    paid: idx("paid", "payment"),
    units: idx("units", "qty"),
    status: idx("claimstatus", "status"),
    patientresp: idx("patientresp", "responsibility", "patientresponsibility"),
    group: idx("group", "casgroup"),
    carc: idx("carc", "reason", "adjustmentreason"),
    adjamt: idx("adjustmentamount", "adjamount", "adjamt"),
  };
  const lines: RemitLine[] = [];
  const claimMap = new Map<string, RemitClaim>();
  for (let i = 1; i < rawLines.length; i++) {
    const c = splitCsvLine(rawLines[i]);
    const get = (j: number) => (j >= 0 ? clean(c[j]) : null);
    const cid = get(ix.claim);
    const hcpcs = get(ix.hcpcs);
    if (!cid && !hcpcs) continue;
    const charge = numOrNull(ix.charge >= 0 ? c[ix.charge] : null);
    const paid = numOrNull(ix.paid >= 0 ? c[ix.paid] : null);
    const adjustments: RemitAdjustment[] = [];
    const carc = get(ix.carc);
    if (carc) adjustments.push({ group: (get(ix.group) || "CO").toUpperCase(), carc, amount: numOrNull(ix.adjamt >= 0 ? c[ix.adjamt] : null) ?? ((charge ?? 0) - (paid ?? 0)) });
    lines.push({ claim_id: cid, hcpcs, mod1: null, rev_code: get(ix.rev), line_charge: charge, line_paid: paid, units: numOrNull(ix.units >= 0 ? c[ix.units] : null), adjustments });
    if (cid) {
      const existing = claimMap.get(cid) || { claim_id: cid, status: get(ix.status), total_charge: 0, total_paid: 0, patient_resp: numOrNull(ix.patientresp >= 0 ? c[ix.patientresp] : null), payer_control: null, adjustments: [] };
      existing.total_charge = (existing.total_charge || 0) + (charge || 0);
      existing.total_paid = (existing.total_paid || 0) + (paid || 0);
      if (!existing.status) existing.status = get(ix.status);
      claimMap.set(cid, existing);
    }
  }
  return { claims: [...claimMap.values()], lines, format: "csv", meta: { claims: claimMap.size, lines: lines.length } };
}

export function parseRemit(text: string): RemitParseResult {
  if (!text || !text.trim()) return { claims: [], lines: [], format: "unknown", meta: { claims: 0, lines: 0, note: "empty file" } };
  return is835(text) ? parse835(text) : parseRemitCsv(text);
}
