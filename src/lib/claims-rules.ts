// ─── Phase-2 Claims Rules (837) ──────────────────────────────
// Run over imported claim service lines (claim_lines) to surface the
// claims-side issues a CDM-only review can't see: Modifier-25 co-billing,
// unbundling modifiers, services billed that aren't in the CDM, and unit
// outliers. Complements the CDM-side rules; only fires when claims are imported.

import type { RuleResult } from "./cdm-reference-rules";
import { normalizeHcpcs } from "./cms-reference";

export interface ClaimLineRow {
  claim_id: string | null;
  rev_code: string | null;
  hcpcs: string | null;
  mod1: string | null; mod2: string | null; mod3: string | null; mod4: string | null;
  units: number | null;
  line_charge: number | null;
  service_date: string | null;
  dx_primary: string | null;
}

const UNBUNDLE_MODS = new Set(["59", "XE", "XS", "XP", "XU"]);
const isEM = (code: string) => /^\d{5}$/.test(code) && +code >= 99201 && +code <= 99499;
const isProcedure = (code: string) => /^\d{5}$/.test(code) && +code >= 10000 && +code <= 69999;
const mods = (l: ClaimLineRow) => [l.mod1, l.mod2, l.mod3, l.mod4].filter(Boolean).map((m) => String(m).toUpperCase());

export function runClaimsRules(items: any[], claims: ClaimLineRow[]): RuleResult[] {
  const out: RuleResult[] = [];
  if (!claims || claims.length === 0) return out;

  // Map a normalized HCPCS to a CDM charge item (for finding linkage) + code set.
  const cdmByCode = new Map<string, any>();
  const cdmCodeSet = new Set<string>();
  for (const it of items) {
    const k = normalizeHcpcs(it.hcpcs_cpt_code);
    if (k) { cdmCodeSet.add(k); if (!cdmByCode.has(k)) cdmByCode.set(k, it); }
  }
  const fallbackId = items[0]?.id || "";
  const linkId = (code: string | null) => (code && cdmByCode.get(normalizeHcpcs(code))?.id) || fallbackId;

  // Group lines by claim.
  const byClaim = new Map<string, ClaimLineRow[]>();
  for (const l of claims) {
    const k = l.claim_id || "(none)";
    if (!byClaim.has(k)) byClaim.set(k, []);
    byClaim.get(k)!.push(l);
  }

  // ── Rule C25: Modifier-25 E/M co-billed with a procedure on the same claim ──
  for (const [claimId, lines] of byClaim) {
    const hasProcedure = lines.some((l) => l.hcpcs && isProcedure(l.hcpcs));
    for (const l of lines) {
      if (!l.hcpcs || !isEM(l.hcpcs)) continue;
      if (!mods(l).includes("25")) continue;
      if (!hasProcedure) continue;
      const procs = lines.filter((x) => x.hcpcs && isProcedure(x.hcpcs)).map((x) => x.hcpcs).slice(0, 4).join(", ");
      out.push({
        rule_id: "C25", charge_item_id: linkId(l.hcpcs),
        title: `Modifier 25 on E/M ${l.hcpcs} billed with a procedure - claim ${claimId}`,
        description: `Claim ${claimId} bills E/M ${l.hcpcs} with modifier 25 on the same claim as procedure(s) ${procs}. Modifier 25 asserts a separately identifiable E/M service; when it is routinely appended alongside a same-day procedure it is a top NCCI audit and denial target.`,
        severity: "high", category: "Modifier 25 Co-Billing (Claims)",
        financial_impact: l.line_charge || undefined,
        recommendation: "Verify the medical record supports a significant, separately identifiable E/M beyond the procedure's inherent pre/post work. Review the frequency of this pairing across claims for a systemic pattern.",
      });
    }
  }

  // ── Rule C59: Unbundling modifiers (59 / X{EPSU}) ──
  // Aggregate by HCPCS to keep the finding count actionable.
  const unbByCode = new Map<string, { count: number; mod: string; charge: number }>();
  for (const l of claims) {
    if (!l.hcpcs) continue;
    const m = mods(l).find((x) => UNBUNDLE_MODS.has(x));
    if (!m) continue;
    const e = unbByCode.get(l.hcpcs) || { count: 0, mod: m, charge: 0 };
    e.count++; e.charge += l.line_charge || 0;
    unbByCode.set(l.hcpcs, e);
  }
  for (const [code, e] of unbByCode) {
    out.push({
      rule_id: "C59", charge_item_id: linkId(code),
      title: `Unbundling modifier ${e.mod} on ${code} (${e.count}x in claims)`,
      description: `HCPCS ${code} is billed with unbundling modifier ${e.mod} on ${e.count} claim line(s). Modifiers 59 and X{EPSU} override NCCI edits to bill services separately; frequent use is a common overpayment and audit exposure.`,
      severity: e.count >= 10 ? "high" : "medium", category: "Unbundling Modifier (Claims)",
      recommendation: "Confirm each use is supported (distinct session, site, or encounter) and that a more specific X{EPSU} modifier is used where applicable. Investigate high-frequency codes for hard-coded modifier use.",
    });
  }

  // ── Rule CNIC: Services billed on claims but not present in the CDM ──
  const notInCdm = new Map<string, { count: number; charge: number }>();
  for (const l of claims) {
    if (!l.hcpcs) continue;
    const k = normalizeHcpcs(l.hcpcs);
    if (cdmCodeSet.has(k)) continue;
    const e = notInCdm.get(l.hcpcs) || { count: 0, charge: 0 };
    e.count++; e.charge += l.line_charge || 0;
    notInCdm.set(l.hcpcs, e);
  }
  for (const [code, e] of notInCdm) {
    out.push({
      rule_id: "CNIC", charge_item_id: fallbackId,
      title: `Billed on claims but not in the CDM - ${code} (${e.count}x)`,
      description: `HCPCS ${code} appears on ${e.count} claim line(s) but is not built in the chargemaster. Services charged outside the CDM bypass its pricing and compliance controls and are a charge-capture and consistency risk.`,
      severity: "low", category: "Billed Not In CDM (Claims)",
      recommendation: `Add ${code} to the CDM with a reviewed price and correct revenue code, or confirm it is intentionally billed off-CDM. Reconcile claim activity against the chargemaster regularly.`,
    });
  }

  // ── Rule CUNIT: Unit outliers vs the code's typical claim units ──
  const unitsByCode = new Map<string, number[]>();
  for (const l of claims) {
    if (!l.hcpcs || l.units == null) continue;
    if (!unitsByCode.has(l.hcpcs)) unitsByCode.set(l.hcpcs, []);
    unitsByCode.get(l.hcpcs)!.push(l.units);
  }
  const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const flaggedUnit = new Set<string>();
  for (const l of claims) {
    if (!l.hcpcs || l.units == null) continue;
    const arr = unitsByCode.get(l.hcpcs)!;
    if (arr.length < 5) continue;
    const med = median(arr);
    if (med > 0 && l.units > med * 3 && l.units >= 5) {
      const key = `${l.hcpcs}|${l.claim_id}`;
      if (flaggedUnit.has(key)) continue;
      flaggedUnit.add(key);
      out.push({
        rule_id: "CUNIT", charge_item_id: linkId(l.hcpcs),
        title: `Unit outlier on ${l.hcpcs}: ${l.units} units - claim ${l.claim_id}`,
        description: `Claim ${l.claim_id} bills ${l.units} units of ${l.hcpcs}, versus a typical ${med} across claims. Large unit counts drive unit-based overpayments and are a frequent audit finding (especially drugs and time-based codes).`,
        severity: "medium", category: "Claim Unit Outlier (Claims)",
        financial_impact: l.line_charge || undefined,
        recommendation: "Verify the units match the documented dosage or time. Check the CDM billing-unit / multiplier for this code so units are calculated correctly at charge entry.",
      });
    }
  }

  return out;
}
