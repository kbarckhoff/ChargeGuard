// ─── NCCI PTP lookup ─────────────────────────────────────────
// The ncci_ptp table holds hundreds of thousands of code-pair edits, so we never
// load it whole. For a scan we fetch only the edits whose Column-1 code appears
// in the client's own billed codes, and build an in-memory map keyed "col1|col2"
// → modifier_indicator. MUE is per-HCPCS and rides the cms_reference overlay
// (getReference().mue), so it needs no separate loader.

import { normalizeHcpcs } from "./cms-reference";

export type PtpMap = Map<string, string | null>; // "col1|col2" -> modifier_indicator

/** Fetch the PTP edits relevant to a set of billed codes (batched .in queries). */
export async function loadRelevantPtp(db: any, codes: Set<string>): Promise<PtpMap> {
  const map: PtpMap = new Map();
  const list = [...codes].map((c) => normalizeHcpcs(c)).filter(Boolean);
  if (list.length === 0) return map;
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const { data, error } = await db.from("ncci_ptp").select("col1, col2, modifier_indicator, deletion").in("col1", chunk);
    if (error || !data) break; // table may not be provisioned/loaded yet → rule no-ops
    for (const r of data as any[]) {
      if (r.deletion && String(r.deletion).trim()) continue; // skip retired edits
      map.set(`${normalizeHcpcs(r.col1)}|${normalizeHcpcs(r.col2)}`, r.modifier_indicator ?? null);
    }
  }
  return map;
}

/** The PTP edit for an ordered pair, or null. col1 is the comprehensive code. */
export function ptpEdit(map: PtpMap, col1: string, col2: string): string | null | undefined {
  return map.get(`${normalizeHcpcs(col1)}|${normalizeHcpcs(col2)}`);
}
