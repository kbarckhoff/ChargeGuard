// ─── CMS Reference Layer ─────────────────────────────────────
// Status Indicator (SI), APC payment, fee schedule, ASP, and retired-code
// reference data, keyed by normalized HCPCS. Starter set extracted from the reference methodology
// the expert's v9-3 CDM Analysis Report ("Hospital CDM + All Flags" tab); replace
// with full CMS source files (Addendum A/B, MPFS, CLFS, ASP) when available.
//
// Implements Formula Library Step 1 (HCPCS normalization) and Step 2/3
// (CPT-MPFS / CLFS-ASP lookups).

import referenceData from "./cms-reference-data.json";
// Part B ASP payment limit + HCPCS billing-unit (dosage) per J-code, from the CMS
// ASP pricing file. The main reference/DB carries SI/APC/MPFS but often lacks the
// billing-unit descriptor, without which the pharmacy billing-unit and UOM rules
// cannot run. This overlay backfills asp + dosage by normalized HCPCS.
import aspDosageData from "./asp-dosage.json";

export interface CmsReference {
  short_desc?: string;
  si?: string;          // OPPS Status Indicator (Addendum B)
  apc_payment?: string; // OPPS Addendum A payment rate
  mc_fee?: string;      // Medicare (MPFS) fee schedule, non-facility
  mc_rvu?: string;
  pf_fee?: string;      // Professional fee (MPFS facility)
  pf_rvu?: string;
  clfs?: string;        // Clinical Lab Fee Schedule
  asp?: string;         // Part B ASP payment limit
  dosage?: string;      // HCPCS billing unit / dosage (e.g. "per 0.25 mg") from the ASP file
  retired?: string;     // "YES" if HCPCS retired / not in current CPT list
}

const REF: Record<string, CmsReference> = referenceData as Record<string, CmsReference>;
const ASP_DOSAGE: Record<string, { asp?: string; dosage?: string }> = aspDosageData as Record<string, { asp?: string; dosage?: string }>;

// Live overlay loaded from the cms_reference table when available. When set, it
// takes precedence over the bundled JSON so the automatic quarterly refresh
// takes effect without a redeploy. Falls back to REF (bundled) if the table is
// empty or unreachable.
let LIVE: Record<string, CmsReference> | null = null;

const DB_COLUMNS = "hcpcs,short_desc,si,apc_payment,mc_fee,mc_rvu,pf_fee,pf_rvu,clfs,asp,dosage,retired";

/**
 * Load the reference table from Supabase into the in-memory overlay. Call once
 * at the start of a scan with a service-role client. Returns the row count
 * loaded (0 = kept the bundled fallback). Never throws.
 */
export async function loadReferenceFromDb(db: any): Promise<number> {
  try {
    const map: Record<string, CmsReference> = {};
    for (let off = 0; ; off += 1000) {
      const { data, error } = await db.from("cms_reference").select(DB_COLUMNS).range(off, off + 999);
      if (error || !data || data.length === 0) break;
      for (const row of data) {
        const { hcpcs, ...rest } = row as any;
        if (hcpcs) map[String(hcpcs)] = rest as CmsReference;
      }
      if (data.length < 1000) break;
    }
    if (Object.keys(map).length > 0) { LIVE = map; return Object.keys(map).length; }
    return 0;
  } catch {
    return 0; // keep bundled fallback
  }
}

/** Which reference set the lookups are currently using. */
export function referenceSource(): "db" | "bundled" {
  return LIVE ? "db" : "bundled";
}

/**
 * Normalize a raw HCPCS/CPT value to the canonical key used by the reference
 * table (Formula Library Step 1a). Numeric codes are zero-padded to 5 chars;
 * letter-prefixed codes (J/G/Q/C/A...) and anesthesia codes keep their form.
 * Strips trailing ".0" that appears when codes are read back from floats.
 */
export function normalizeHcpcs(raw: string | null | undefined): string {
  if (raw == null) return "";
  let s = String(raw).trim().toUpperCase();
  if (!s) return "";
  // strip trailing .0 / .00 (float artifact)
  s = s.replace(/\.0+$/, "");
  // pure-numeric → zero-pad to 5
  if (/^\d+$/.test(s)) return s.padStart(5, "0");
  // alpha-prefixed HCPCS (e.g. J1885, G0008, C1778) → letter + zero-padded digits
  const m = s.match(/^([A-Z])(\d+)$/);
  if (m) return m[1] + m[2].padStart(4, "0");
  return s;
}

/** Look up CMS reference data for a raw HCPCS value. Returns null if unknown. */
export function getReference(rawHcpcs: string | null | undefined): CmsReference | null {
  const key = normalizeHcpcs(rawHcpcs);
  if (!key) return null;
  const base = (LIVE ?? REF)[key] ?? null;
  const od = ASP_DOSAGE[key];
  if (!od) return base;
  // Backfill asp + dosage from the ASP file when the primary reference is missing
  // them (the DB/bundled reference carries SI/MPFS but usually not the billing unit).
  if (!base) return { ...od };
  return {
    ...base,
    asp: (base.asp != null && String(base.asp).trim() !== "") ? base.asp : od.asp,
    dosage: (base.dosage != null && String(base.dosage).trim() !== "") ? base.dosage : od.dosage,
  };
}

/** Parse a possibly-blank numeric reference field to a number (0 if blank/NaN). */
export function refNum(v: string | undefined): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export const referenceCodeCount = Object.keys(REF).length;

/** Coverage counts per fee schedule — how many codes carry each reference value.
 * Used by the Benchmarks page so the numbers reflect the actual bundled data. */
export function referenceCoverage() {
  const keys = Object.keys(REF);
  const nonEmpty = (v: string | undefined) => v != null && String(v).trim() !== "";
  return {
    total: keys.length,
    si: keys.filter((k) => nonEmpty(REF[k].si)).length,
    apc: keys.filter((k) => nonEmpty(REF[k].apc_payment)).length,
    mpfs: keys.filter((k) => nonEmpty(REF[k].mc_fee)).length,
    clfs: keys.filter((k) => nonEmpty(REF[k].clfs)).length,
    asp: keys.filter((k) => nonEmpty(REF[k].asp)).length,
    retired: keys.filter((k) => String(REF[k].retired || "").toUpperCase() === "YES").length,
  };
}
