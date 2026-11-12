// ─── CONVERGE setup-fact gating (Phase A finish) ─────────────
// Greg's discipline (CONVERGE guide §2.4 / §5.4): a required facility fact that
// no data file contains should BLOCK or CAVEAT the rules that depend on it,
// rather than letting the engine emit a confident-but-wrong number.
//
// We apply this at scan time, after the rules run. Each gate ties a setup fact
// to the finding CATEGORIES it governs. When the fact is missing/unknown:
//   • mode "block"  — drop those findings entirely (used only where firing
//                     without the fact is simply invalid, e.g. waived-test QW).
//   • mode "caveat" — keep the finding but mark it provisional: append a note to
//                     its recommendation so the consultant knows it assumes a
//                     default until the fact is confirmed. Nothing is lost.
//
// This matches the per-client, consultant-operated model: Greg answers the
// questionnaire and the caveats clear; until then the diagnostic is honest about
// what it assumed.

import type { SetupFacts } from "./setup-questionnaire";

type GateMode = "block" | "caveat";

interface Gate {
  factId: string;
  label: string;           // human name of the fact
  categories: RegExp;      // finding categories this fact governs
  mode: GateMode;
  note: string;            // appended to a caveated finding's recommendation
}

// Only the REQUIRED facts gate. Kept deliberately narrow so a working rule set is
// never silently gutted: fee-schedule/pricing findings are caveated (not dropped),
// and only the genuinely-invalid-without-the-fact case (CLIA waived tests) blocks.
const GATES: Gate[] = [
  {
    factId: "status_340b",
    label: "340B status",
    categories: /pass-through asp markup|340b|pharmacy.*(markup|pricing)|drug.*markup/i,
    mode: "caveat",
    note: "Provisional — assumes non-340B pricing. Confirm 340B status; a covered entity changes the expected drug reimbursement and can reverse this finding.",
  },
  {
    factId: "mac_locality",
    label: "MAC / locality",
    categories: /si=a non-opps|bilateral pricing|laboratory pricing|clfs/i,
    mode: "caveat",
    note: "Provisional — priced against the national/state fee schedule. Confirm the MAC and locality to finalize the expected rate.",
  },
  {
    factId: "clia_certificate",
    label: "CLIA certificate",
    categories: /waived|\bqw\b|clia/i,
    mode: "block",
    note: "Blocked — waived-test (QW) billing permissibility depends on the site's CLIA certificate type.",
  },
];

function factMissing(facts: SetupFacts | null | undefined, factId: string): boolean {
  const v = (facts || {})[factId];
  return v === undefined || v === null || v === "" || v === "unknown";
}

export interface GatedResult<T> {
  results: T[];                                  // kept findings (caveated ones annotated)
  summary: {
    missingFacts: string[];                      // labels of unanswered required facts that gated something
    blocked: number;                             // findings dropped
    caveated: number;                            // findings kept but marked provisional
    byFact: Record<string, { mode: GateMode; blocked: number; caveated: number }>;
  };
}

/**
 * Apply setup-fact gates to a list of rule results. `getCategory` extracts the
 * category string from a result; `withNote` returns a copy of the result with the
 * caveat note appended to its recommendation. Generic so it works on the scan's
 * RuleResult shape without importing it.
 */
export function applySetupGates<T>(
  results: T[],
  facts: SetupFacts | null | undefined,
  getCategory: (r: T) => string | null | undefined,
  appendNote: (r: T, note: string) => T,
): GatedResult<T> {
  const active = GATES.filter((g) => factMissing(facts, g.factId));
  const summary: GatedResult<T>["summary"] = { missingFacts: [], blocked: 0, caveated: 0, byFact: {} };
  if (active.length === 0) return { results, summary };

  for (const g of active) summary.byFact[g.label] = { mode: g.mode, blocked: 0, caveated: 0 };

  const kept: T[] = [];
  for (const r of results) {
    const cat = getCategory(r) || "";
    const gate = active.find((g) => g.categories.test(cat));
    if (!gate) { kept.push(r); continue; }
    if (gate.mode === "block") {
      summary.blocked++;
      summary.byFact[gate.label].blocked++;
      continue; // dropped
    }
    // caveat
    summary.caveated++;
    summary.byFact[gate.label].caveated++;
    kept.push(appendNote(r, gate.note));
  }

  summary.missingFacts = active
    .filter((g) => summary.byFact[g.label].blocked + summary.byFact[g.label].caveated > 0)
    .map((g) => g.label);

  return { results: kept, summary };
}
