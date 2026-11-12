// ─── CONVERGE opportunity model (Phase A) ────────────────────
// Turns the engine's raw findings into the finance-facing model a CFO actually
// buys: a conservative NET-realizable number (not gross), split recurring vs
// one-time, an opportunity waterfall, a cost-of-inaction figure, and a
// speed-to-cash → phase assignment. Pure function; no I/O.
//
// Greg's discipline (from the CONVERGE guide, §5.3): dollars only where real,
// net ≤ gross, recurring and one-time never blended, and the realization rates
// are the one place with real assumptions — conservative by default.

import { classForCategory, type FindingClass } from "./finding-class";

export interface OppFinding {
  category: string | null;
  financial_impact?: number | null;
  severity?: string;
}

export type Cadence = "recurring" | "one_time";
export type Phase = "phase_1" | "phase_2";

// Conservative realization rate by fix type: how much of the gross we expect to
// actually capture. Auto-deny/coding fixes realize near-full (the leak simply
// stops); pricing needs payer mix + contracts, so it's discounted hard; data
// cleanup is uncertain. Tune these in one place — credibility depends on not
// overstating.
export const REALIZATION: Record<FindingClass, number> = {
  code_validity: 0.90,
  data_quality: 0.50,
  pricing: 0.40,
  informational: 0,
};

// How the money behaves: coding/pricing leaks recur every period once fixed;
// one-time data cleanups don't. Kept separate so they're never summed together.
const CADENCE_BY_CLASS: Record<FindingClass, Cadence> = {
  code_validity: "recurring",
  pricing: "recurring",
  data_quality: "one_time",
  informational: "one_time",
};

// Speed-to-cash: coding/data fixes need no client data and land fast (Phase 1,
// the "quick wins" that prove the number); pricing alignment is a longer
// workstream (Phase 2).
const PHASE_BY_CLASS: Record<FindingClass, Phase> = {
  code_validity: "phase_1",
  data_quality: "phase_1",
  pricing: "phase_2",
  informational: "phase_1",
};

export interface CategoryLine {
  category: string;
  cls: FindingClass;
  count: number;
  gross: number;
  net: number;
  cadence: Cadence;
  phase: Phase;
}

export interface WaterfallStep { label: string; amount: number }

export interface OpportunityModel {
  grossTotal: number;
  netTotal: number;
  netRecurring: number;   // annual, repeating
  netOneTime: number;     // captured once
  confidence: { low: number; expected: number; high: number }; // ± band on net
  byCategory: CategoryLine[];
  waterfall: WaterfallStep[];      // current → increments → target (needs currentNetRevenue)
  costOfInaction: {                // the risk half of the decision
    dailyLeak: number;             // recurring leak per day (annual recurring ÷ 365)
    complianceAtRisk: number;      // compliance-relevant findings carrying $0 but real risk
    complianceFindingCount: number;
  };
  phase1Net: number;
  phase2Net: number;
}

/**
 * Build the opportunity model from findings.
 * @param findings    the engine's findings (category + financial_impact).
 * @param opts.currentNetRevenue  optional; if given, the waterfall bridges from it.
 * @param opts.confidenceBand     ± fraction for the band (default 0.25).
 */
export function buildOpportunityModel(
  findings: OppFinding[],
  opts: { currentNetRevenue?: number; confidenceBand?: number } = {},
): OpportunityModel {
  const band = opts.confidenceBand ?? 0.25;
  const byCat = new Map<string, CategoryLine>();
  let complianceAtRisk = 0, complianceFindingCount = 0;

  for (const f of findings) {
    const category = (f.category || "Uncategorized").trim();
    const cls = classForCategory(category);
    const gross = Number(f.financial_impact) || 0;

    // Compliance-relevant at $0: informational/compliance findings with no dollar
    // are still real risk (price transparency, 340B, etc.) — counted separately.
    if (gross <= 0 && (cls === "informational" || /complian|transparen|retired|device|self-admin|modifier/i.test(category))) {
      complianceFindingCount++;
    }

    const e = byCat.get(category) || {
      category, cls, count: 0, gross: 0, net: 0,
      cadence: CADENCE_BY_CLASS[cls], phase: PHASE_BY_CLASS[cls],
    };
    e.count++;
    e.gross += gross;
    e.net += gross * REALIZATION[cls];
    byCat.set(category, e);
  }

  const byCategory = [...byCat.values()].sort((a, b) => b.net - a.net);
  const grossTotal = byCategory.reduce((s, c) => s + c.gross, 0);
  const netTotal = byCategory.reduce((s, c) => s + c.net, 0);
  const netRecurring = byCategory.filter((c) => c.cadence === "recurring").reduce((s, c) => s + c.net, 0);
  const netOneTime = byCategory.filter((c) => c.cadence === "one_time").reduce((s, c) => s + c.net, 0);
  const phase1Net = byCategory.filter((c) => c.phase === "phase_1").reduce((s, c) => s + c.net, 0);
  const phase2Net = byCategory.filter((c) => c.phase === "phase_2").reduce((s, c) => s + c.net, 0);

  // Waterfall: current net revenue → phase 1 quick wins → phase 2 pricing → target.
  const base = opts.currentNetRevenue ?? 0;
  const waterfall: WaterfallStep[] = [
    { label: "Current net revenue", amount: base },
    { label: "Phase 1 — quick wins", amount: phase1Net },
    { label: "Phase 2 — pricing & workstreams", amount: phase2Net },
    { label: "Target state", amount: base + phase1Net + phase2Net },
  ];

  return {
    grossTotal,
    netTotal,
    netRecurring,
    netOneTime,
    confidence: { low: netTotal * (1 - band), expected: netTotal, high: netTotal * (1 + band) },
    byCategory,
    waterfall,
    costOfInaction: {
      dailyLeak: netRecurring / 365,
      complianceAtRisk,
      complianceFindingCount,
    },
    phase1Net,
    phase2Net,
  };
}
