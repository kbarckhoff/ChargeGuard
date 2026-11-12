# CONVERGE (branch: `converge`)

CONVERGE is the Amelior + services productization of the ChargeGuard engine: the
same rule core, extended into the full four-file revenue-cycle diagnostic and
packaged as a consulting offering (engine computes, consultant judges).

**This branch builds CONVERGE on top of ChargeGuard. `main` stays ChargeGuard and
keeps deploying to production untouched.**

## The one rule for this branch

Keep the rule engine shared with ChargeGuard. The analytical logic lives in
`src/lib` (`cdm-reference-rules.ts`, `structural-rules.ts`, `peer-rules.ts`,
`device-crosswalk.ts`, `pharmacy.ts`, `cms-reference.ts`). Change the app *around*
the engine, not the engine itself, so a rule fix can be shared both ways. The
standalone offline engine in `engine/` already depends on these same files.

## What CONVERGE adds vs ChargeGuard (phased, from the gap analysis)

Phase A — finance layer + exec output (uses the CDM + R&U we already ingest):
- [x] Opportunity model: net-realizable, waterfall, cost-of-inaction, recurring
      vs one-time, speed-to-cash → phase.  `src/lib/opportunity.ts` + `/opportunity`
- [x] RC Health Scorecard (overall grade + 8 functional-area scores from Greg's
      template).  `src/lib/scorecard.ts` + `/scorecard`
- [x] Setup questionnaire as fact gates (340B, MAC/locality, CLIA, …).
      `src/lib/setup-questionnaire.ts` + `/setup`
- [ ] "Decide" exec narrative + downloadable deck of the scorecard/opportunity.
- [ ] Wire the setup-fact gates INTO the scan (block gated rules when a fact is
      missing, instead of just displaying the gate).
- [ ] Per-run reference-vintage pinning.

Phase B — the claims layer (the actual "Converge"):
- [ ] 835 + 837 X12 ingestion into a normalized claim/remit schema (an 837 parser
      exists in `src/lib/claims-parser.ts`; add 835 remittance + the UI tiles).
- [ ] The five cross-file joins, incl. the denial → claim → CDM root-cause trace.
      Until this lands, the scorecard's claims-dependent areas show "pending".

Phase C — presentation + deployment:
- [ ] "Explore" dashboard; decouple the engine so the viz is a swappable skin.
- [ ] Per-client, in-their-environment (under their BAA) deployment model.
      (The offline `engine/` CLI is the start of this.)

## Status — done on this branch

- Branding: `src/lib/product.ts` → "Converge" in the sidebar.
- `/scorecard` — RC Health Scorecard (flagship), from the engine's findings.
- `/opportunity` — net-realizable opportunity model + waterfall.
- `/setup` — setup questionnaire with required-fact gating.
- Nav updated; engine kept shared with ChargeGuard; all type-checks clean.

## Status — not yet built (bigger lifts, next)

- 835/837 ingestion + the 5 cross-file joins (Phase B).
- The "Decide" exec deck export.
- Wiring setup-fact gates into the scan, and per-run reference pinning.
- In-client deployment packaging beyond the offline CLI.
