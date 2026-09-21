// ─── Named-Competitor Peer Pricing Rule ──────────────────────
// Compares each priced CDM line to the AVERAGE gross charge that the uploaded
// competitors post for the same HCPCS (from their price-transparency files).
// Complements the CMS national/state benchmark; only fires when competitor
// price files have been loaded in Peer Setup.
//
// A peer file lists one gross per code, but a CDM can reuse the same HCPCS on
// several charge lines at different prices. Comparing every such line to the
// peer average produces false "10x overprice" findings when the real problem is
// the coding. So codes that sit on ONE CDM line get a trusted price outlier,
// and codes on MULTIPLE CDM lines get a data-quality finding instead.

import type { RuleResult } from "./cdm-reference-rules";
import { normalizeHcpcs, getReference } from "./cms-reference";
import { descMatchScore, confidenceLabel } from "./peer-match";
import { isPharmacyLine } from "./pharmacy";

export interface PeerPrice { hcpcs: string; gross_charge: number | null; competitor: string }

const PC_LOW = 0.75;  // below this fraction of the competitor average = underpriced
const PC_HIGH = 1.5;  // above this multiple of the competitor average = over-market

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function runPeerCompetitorRules(items: any[], peerRows: PeerPrice[], formularyCodes?: Set<string> | null): RuleResult[] {
  const out: RuleResult[] = [];
  if (!peerRows || peerRows.length === 0) return out;

  // Average competitor gross per HCPCS (and how many competitors quote it).
  const agg = new Map<string, { sum: number; comps: Set<string> }>();
  for (const p of peerRows) {
    const k = normalizeHcpcs(p.hcpcs);
    const g = Number(p.gross_charge) || 0;
    if (!k || g <= 0) continue;
    const e = agg.get(k) || { sum: 0, comps: new Set<string>() };
    e.sum += g; e.comps.add(p.competitor);
    agg.set(k, e);
  }
  const avg = new Map<string, { avg: number; n: number }>();
  for (const [k, e] of agg) avg.set(k, { avg: e.sum / e.comps.size, n: e.comps.size });

  // Group priced CDM lines by normalized code so we can tell clean 1-to-1 codes
  // from codes reused across multiple lines.
  const byCode = new Map<string, any[]>();
  for (const item of items) {
    const price = Number(item.gross_charge) || 0;
    if (price <= 0) continue;
    // Formularies differ across like facilities, so pharmacy lines are not
    // comparable on gross charge — leave them out of peer pricing.
    if (isPharmacyLine(item, formularyCodes)) continue;
    const k = normalizeHcpcs(item.hcpcs_cpt_code || "");
    if (!k || !avg.has(k)) continue; // only codes a competitor also lists
    if (!byCode.has(k)) byCode.set(k, []);
    byCode.get(k)!.push(item);
  }

  for (const [code, lines] of byCode) {
    const m = avg.get(code)!;
    const peer = money(m.avg);
    const src = `${m.n} competitor${m.n > 1 ? "s" : ""}`;

    // ── Clean 1-to-1: one CDM line for this code → trusted price outlier ──
    if (lines.length === 1) {
      const item = lines[0];
      const price = Number(item.gross_charge) || 0;
      const procNum = item.procedure_number || item.id;
      const ratio = price / m.avg;
      const pct = Math.round(ratio * 100);

      if (ratio < PC_LOW) {
        out.push({
          rule_id: "PC.low", charge_item_id: item.id,
          title: `Below competitors — ${code} at ${pct}% of peer average - ${procNum}`,
          description: `"${item.charge_description}" (${code}) is priced ${money(price)}, only ${pct}% of the ${peer} average charged by ${src} in this market. This is potential revenue left on the table. (One CDM line uses this code, so the match is clean.)`,
          severity: ratio < 0.5 ? "high" : "medium",
          category: "Peer Pricing (Named Competitors)",
          financial_impact: m.avg - price > 0 ? m.avg - price : undefined,
          recommendation: `Review whether ${code} should be raised toward the local market rate (${peer} across ${src}).`,
        });
      } else if (ratio > PC_HIGH) {
        out.push({
          rule_id: "PC.high", charge_item_id: item.id,
          title: `Above competitors — ${code} at ${pct}% of peer average - ${procNum}`,
          description: `"${item.charge_description}" (${code}) is priced ${money(price)}, ${ratio.toFixed(1)}× the ${peer} average charged by ${src} in this market. Outlier pricing versus named local competitors is a transparency and patient-complaint risk. (One CDM line uses this code, so the match is clean.)`,
          severity: ratio > 3 ? "high" : "medium",
          category: "Peer Pricing (Named Competitors)",
          recommendation: `Confirm the charge for ${code} is defensible versus local competitors (${peer} across ${src}).`,
        });
      }
      continue;
    }

    // ── Multi-line: same code on several CDM lines → data-quality finding ──
    const prices = lines.map((l) => Number(l.gross_charge) || 0);
    const min = Math.min(...prices), max = Math.max(...prices);
    const spread = min > 0 ? max / min : Infinity;

    // Pick the line whose description best matches the official code descriptor;
    // that is the line most likely to actually belong to this code.
    let best = lines[0], bestScore = -1;
    for (const l of lines) {
      const sc = descMatchScore(l.charge_description || "", code);
      if (sc != null && sc > bestScore) { bestScore = sc; best = l; }
    }
    const bestPrice = Number(best.gross_charge) || 0;
    const bestRatio = bestPrice / m.avg;
    const bestPct = Math.round(bestRatio * 100);
    const conf = confidenceLabel(bestScore < 0 ? null : bestScore);
    const codeDesc = getReference(code)?.short_desc;

    const spreadHigh = spread >= 3 || bestRatio > 3 || bestRatio < 0.5;
    const listing = lines
      .slice()
      .sort((a, b) => (Number(b.gross_charge) || 0) - (Number(a.gross_charge) || 0))
      .map((l) => `"${l.charge_description}" ${money(Number(l.gross_charge) || 0)}`)
      .join("; ");

    out.push({
      rule_id: "PC.multiline", charge_item_id: best.id,
      title: `Same code on ${lines.length} lines — ${code} spans ${money(min)} to ${money(max)}`,
      description:
        `${code}${codeDesc ? ` ("${codeDesc}")` : ""} is on ${lines.length} CDM lines priced ${money(min)} to ${money(max)}, while ${src} average ${peer}. Prices this spread out under one code usually mean different services share a code, which is a coding or mapping issue, not a straight price outlier. Lines: ${listing}. ` +
        (conf === "n/a"
          ? `Confirm each line is coded correctly before benchmarking any of them.`
          : `Best match to the code descriptor is "${best.charge_description}" at ${money(bestPrice)} (${bestPct}% of peer, ${conf} confidence). Fix the coding on the other lines, then re-benchmark.`),
      severity: spreadHigh ? "high" : "medium",
      category: "Peer Pricing (Data Quality)",
      recommendation: `Map each of the ${lines.length} lines under ${code} to its correct HCPCS, then re-run the peer comparison so pricing findings are trustworthy.`,
    });
  }

  return out;
}
