// ─── Converge intake parsers (step 1: imports) ───────────────
// Header-mapped CSV parsers for the three new de-identified inputs: the claims
// extract, the item master, and the GL/department list. Framework-free (browser
// + Node). Columns are matched loosely by header keyword so they tolerate what-
// ever the client's export calls them; tighten the hints when the spec firms up.

const numOrNull = (v: any): number | null => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
};
const clean = (v: any): string | null => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
const boolOf = (v: any): boolean | null => {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (["y", "yes", "true", "1", "active", "a"].includes(s)) return true;
  if (["n", "no", "false", "0", "inactive", "i"].includes(s)) return false;
  return null;
};

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
function headerIndexer(headerLine: string) {
  const headers = splitCsvLine(headerLine).map((h) => h.toLowerCase().replace(/[\s_\-./]/g, ""));
  return (...hints: string[]) => { for (const h of hints) { const i = headers.findIndex((c) => c.includes(h)); if (i >= 0) return i; } return -1; };
}

export interface ParseMeta { rows: number; format: "csv"; note?: string }

export interface ClaimsExtractRow {
  claim_id: string | null; line_control: string | null; service_date: string | null; hcpcs: string | null;
  mod1: string | null; mod2: string | null; mod3: string | null; mod4: string | null;
  rev_code: string | null; units: number | null; dx_code: string | null; place_of_service: string | null;
  billed_amount: number | null; allowed_amount: number | null; paid_amount: number | null;
  contractual_adj: number | null; patient_resp: number | null;
  denial_code: string | null; rarc_code: string | null; cas_group: string | null; payer: string | null;
}
export function parseClaimsExtract(text: string): { rows: ClaimsExtractRow[]; meta: ParseMeta } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], meta: { rows: 0, format: "csv", note: "empty" } };
  const idx = headerIndexer(lines[0]);
  const ix = {
    claim: idx("claimid", "claimnumber", "claimcontrol", "claim", "clm", "patientcontrol", "referencenumber", "refnumber"),
    line: idx("linecontrol", "linenumber", "lineid", "linenum", "svcline"),
    date: idx("servicedate", "dos", "dateofservice", "paiddate", "date"),
    hcpcs: idx("hcpcs", "cpt", "procedure", "code"),
    mod1: idx("modifier1", "mod1", "modifier"),
    mod2: idx("modifier2", "mod2"),
    mod3: idx("modifier3", "mod3"),
    mod4: idx("modifier4", "mod4"),
    rev: idx("revcode", "revenuecode", "rev"),
    units: idx("units", "unit", "qty"),
    dx: idx("diagnosis", "dxcode", "icd", "principaldx", "dx"),
    pos: idx("placeofservice", "pos"),
    billed: idx("billed", "charge", "submitted", "grosscharge"),
    allowed: idx("allowed", "allowable", "contracted"),
    paid: idx("paid", "payment", "paidamount"),
    contractual: idx("contractual", "contractadj", "coadjustment", "writeoff"),
    patresp: idx("patientresp", "patientresponsibility", "pr", "patientliability"),
    carc: idx("denial", "carc", "adjustmentreason", "reasoncode"),
    rarc: idx("rarc", "remark", "remittanceremark"),
    group: idx("casgroup", "group", "adjustmentgroup"),
    payer: idx("payer", "payor", "insurance", "plan"),
  };
  const rows: ClaimsExtractRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const g = (j: number) => (j >= 0 ? clean(c[j]) : null);
    const n = (j: number) => numOrNull(j >= 0 ? c[j] : null);
    if (!g(ix.claim) && !g(ix.hcpcs)) continue;
    rows.push({
      claim_id: g(ix.claim), line_control: g(ix.line), service_date: g(ix.date), hcpcs: g(ix.hcpcs),
      mod1: g(ix.mod1), mod2: g(ix.mod2), mod3: g(ix.mod3), mod4: g(ix.mod4),
      rev_code: g(ix.rev), units: n(ix.units), dx_code: g(ix.dx), place_of_service: g(ix.pos),
      billed_amount: n(ix.billed), allowed_amount: n(ix.allowed), paid_amount: n(ix.paid),
      contractual_adj: n(ix.contractual), patient_resp: n(ix.patresp),
      denial_code: g(ix.carc), rarc_code: g(ix.rarc), cas_group: g(ix.group), payer: g(ix.payer),
    });
  }
  return { rows, meta: { rows: rows.length, format: "csv" } };
}

export interface ItemMasterRow {
  item_number: string | null; description: string | null; hcpcs: string | null; rev_code: string | null;
  c_code: string | null; is_device: boolean | null; charge_code: string | null;
  cost_center: string | null; uom: string | null; is_active: boolean | null;
}
export function parseItemMaster(text: string): { rows: ItemMasterRow[]; meta: ParseMeta } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], meta: { rows: 0, format: "csv", note: "empty" } };
  const idx = headerIndexer(lines[0]);
  const ix = {
    item: idx("itemnumber", "itemid", "itemno", "item", "materialnumber", "sku"),
    desc: idx("description", "itemdescription", "desc", "name"),
    hcpcs: idx("hcpcs", "cpt", "procedure", "code"),
    rev: idx("revcode", "revenuecode", "rev"),
    ccode: idx("ccode", "devicecode", "hcpcsdevice"),
    device: idx("isdevice", "device", "implant"),
    charge: idx("chargecode", "chargenumber", "cdmcode", "cdm"),
    cc: idx("costcenter", "department", "dept"),
    uom: idx("uom", "unitofmeasure", "billingunit", "packageunit"),
    active: idx("active", "status", "isactive"),
  };
  const rows: ItemMasterRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const g = (j: number) => (j >= 0 ? clean(c[j]) : null);
    if (!g(ix.item) && !g(ix.hcpcs) && !g(ix.desc)) continue;
    const ccode = g(ix.ccode);
    rows.push({
      item_number: g(ix.item), description: g(ix.desc), hcpcs: g(ix.hcpcs), rev_code: g(ix.rev),
      c_code: ccode, is_device: ix.device >= 0 ? boolOf(c[ix.device]) : (ccode ? true : null),
      charge_code: g(ix.charge), cost_center: g(ix.cc), uom: g(ix.uom),
      is_active: ix.active >= 0 ? boolOf(c[ix.active]) : null,
    });
  }
  return { rows, meta: { rows: rows.length, format: "csv" } };
}

export interface GlDeptRow { gl_number: string | null; department_name: string | null; charge_prefix: string | null; cost_center: string | null }
export function parseGlDepartments(text: string): { rows: GlDeptRow[]; meta: ParseMeta } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], meta: { rows: 0, format: "csv", note: "empty" } };
  const idx = headerIndexer(lines[0]);
  const ix = {
    gl: idx("glnumber", "glcode", "glaccount", "gl", "accountnumber", "account"),
    dept: idx("departmentname", "department", "deptname", "dept"),
    prefix: idx("chargeprefix", "prefix", "chargecodeprefix", "chargenumberprefix"),
    cc: idx("costcenter", "cc"),
  };
  const rows: GlDeptRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitCsvLine(lines[i]);
    const g = (j: number) => (j >= 0 ? clean(c[j]) : null);
    if (!g(ix.gl) && !g(ix.dept)) continue;
    rows.push({ gl_number: g(ix.gl), department_name: g(ix.dept), charge_prefix: g(ix.prefix), cost_center: g(ix.cc) });
  }
  return { rows, meta: { rows: rows.length, format: "csv" } };
}
