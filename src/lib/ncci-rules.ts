// ─── NCCI rules (PTP unbundling + MUE unit cap) ──────────────
// Uses the NCCI reference layer: ncci_ptp (code pairs, via the PtpMap) and the
// per-HCPCS MUE on cms_reference (getReference().mue). Runs on the de-identified
// claims extract. Findings attach to the CDM line matching the governing code.

import { getReference, normalizeHcpcs } from "./cms-reference";
import { ptpEdit, type PtpMap } from "./ncci";
import type { ConvergeRuleResult } from "./converge-rules";

export interface NcciClaimRow {
  claim_id: string | null; hcpcs: string | null;
  mod1: string | null; mod2: string | null; mod3: string | null; mod4: string | null;
  units: number | null; billed_amount: number | null;
}
interface CdmLite { id: string; hcpcs_cpt_code: string | null; charge_description?: string | null }

const norm = (s: any) => normalizeHcpcs(String(s ?? ""));
// Modifiers that can override a PTP edit whose indicator = "1".
const OVERRIDE = new Set(["59", "XE", "XS", "XP", "XU", "91", "25", "27", "57", "24", "78", "79"]);

function cdmIndex(cdm: CdmLite[]): Map<string, CdmLite> {
  const m = new Map<string, CdmLite>();
  for (const it of cdm) { const k = norm(it.hcpcs_cpt_code); if (k && !m.has(k)) m.set(k, it); }
  return m;
}

/** NCCI PTP unbundling: a Column-1/Column-2 pair billed together on a claim with
 *  no allowed modifier override. Indicator 0 never unbundles; 1 needs a modifier. */
export function runPtpUnbundlingRules(cdm: CdmLite[], claims: NcciClaimRow[], ptp: PtpMap): ConvergeRuleResult[] {
  const idx = cdmIndex(cdm);
  const byClaim = new Map<string, NcciClaimRow[]>();
  for (const r of claims) { const k = r.claim_id || "__none"; (byClaim.get(k) || byClaim.set(k, []).get(k)!).push(r); }

  // aggregate by (col1|col2) so one finding summarizes many claims
  const agg = new Map<string, { col1: string; col2: string; ind: string; count: number }>();
  for (const [, lines] of byClaim) {
    const codes = lines.map((l) => ({ h: norm(l.hcpcs), mods: [l.mod1, l.mod2, l.mod3, l.mod4].map((m) => String(m ?? "").trim().toUpperCase()).filter(Boolean) }));
    for (const a of codes) for (const b of codes) {
      if (a.h === b.h || !a.h || !b.h) continue;
      const ind = ptpEdit(ptp, a.h, b.h);
      if (ind === undefined || ind === null) continue; // no edit for this ordered pair
      if (ind === "9") continue;                        // not applicable
      // Column-2 (component) is b; a modifier on the component line clears a "1" edit.
      const hasOverride = b.mods.some((m) => OVERRIDE.has(m));
      if (ind === "1" && hasOverride) continue;
      const key = `${a.h}|${b.h}`;
      const e = agg.get(key) || { col1: a.h, col2: b.h, ind, count: 0 }; e.count++; agg.set(key, e);
    }
  }
  const out: ConvergeRuleResult[] = [];
  for (const e of agg.values()) {
    const cdmLine = idx.get(e.col2) || idx.get(e.col1);
    if (!cdmLine) continue;
    out.push({
      rule_id: `NCCI.ptp.${e.ind}`, charge_item_id: cdmLine.id,
      title: `NCCI unbundling — ${e.col2} billed with ${e.col1}`,
      description: `${e.col2} (Column 2) was billed with ${e.col1} (Column 1) on ${e.count} claim(s). NCCI modifier indicator ${e.ind}: ${e.ind === "0" ? "the pair is never separately payable" : "separate payment needs an appropriate override modifier (e.g. 59/XU), which was not present"}.`,
      severity: e.ind === "0" ? "high" : "medium",
      category: "NCCI Unbundling (PTP)",
      recommendation: e.ind === "0" ? `Do not bill ${e.col2} with ${e.col1}; it is bundled.` : `Add an appropriate modifier (59 / XE / XS / XP / XU) to ${e.col2} only when the service is genuinely distinct, else remove it.`,
    });
  }
  return out;
}

/** MUE: a claim line billed above the per-HCPCS Medically Unlikely Edit cap. */
export function runMueRules(cdm: CdmLite[], claims: NcciClaimRow[]): ConvergeRuleResult[] {
  const idx = cdmIndex(cdm);
  // aggregate by hcpcs
  const agg = new Map<string, { hcpcs: string; mue: number; count: number; maxUnits: number }>();
  for (const r of claims) {
    const h = norm(r.hcpcs); if (!h) continue;
    const units = Number(r.units) || 0;
    const ref = getReference(h);
    const mue = ref?.mue;
    if (!mue || mue <= 0 || units <= mue) continue;
    const e = agg.get(h) || { hcpcs: h, mue, count: 0, maxUnits: 0 }; e.count++; e.maxUnits = Math.max(e.maxUnits, units); agg.set(h, e);
  }
  const out: ConvergeRuleResult[] = [];
  for (const e of agg.values()) {
    const cdmLine = idx.get(e.hcpcs);
    if (!cdmLine) continue;
    out.push({
      rule_id: "NCCI.mue", charge_item_id: cdmLine.id,
      title: `Over MUE unit cap — ${e.hcpcs}`,
      description: `${e.hcpcs} was billed above its Medically Unlikely Edit cap of ${e.mue} unit(s) on ${e.count} claim(s) (up to ${e.maxUnits} units). Units over the MUE deny or require documentation.`,
      severity: "medium", category: "MUE Unit Cap",
      recommendation: `Confirm the units billed for ${e.hcpcs} are correct and documented; units over the MUE of ${e.mue} will be denied unless an appropriate modifier and documentation support them.`,
    });
  }
  return out;
}
