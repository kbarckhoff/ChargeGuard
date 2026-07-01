// ─── CMS Reference Layer ─────────────────────────────────────
// Status Indicator (SI), APC payment, fee schedule, ASP, and retired-code
// reference data, keyed by normalized HCPCS. Starter set extracted from Greg
// Brazzel's v9-3 CDM Analysis Report ("Hospital CDM + All Flags" tab); replace
// with full CMS source files (Addendum A/B, MPFS, CLFS, ASP) when available.
//
// Implements Formula Library Step 1 (HCPCS normalization) and Step 2/3
// (CPT-MPFS / CLFS-ASP lookups).

import referenceData from "./cms-reference-data.json";

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
  return REF[key] ?? null;
}

/** Parse a possibly-blank numeric reference field to a number (0 if blank/NaN). */
export function refNum(v: string | undefined): number {
  if (v == null || v === "") return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export const referenceCodeCount = Object.keys(REF).length;
