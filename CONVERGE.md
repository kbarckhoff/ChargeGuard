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
- [ ] Opportunity model: net-realizable (not gross), waterfall, cost-of-inaction,
      recurring vs one-time, speed-to-cash → phase.  → `src/lib/opportunity.ts`
- [ ] "Decide" exec narrative + deck output.
- [ ] Setup questionnaire as real rule gates (340B, MAC/locality, CLIA, …).
- [ ] Per-run reference-vintage pinning.

Phase B — the claims layer (the actual "Converge"):
- [ ] 835 + 837 X12 ingestion into a normalized claim/remit schema.
- [ ] The five cross-file joins, incl. the denial → claim → CDM root-cause trace.

Phase C — presentation + deployment:
- [ ] "Explore" dashboard; decouple the engine so the viz is a swappable skin.
- [ ] Per-client, in-their-environment (under their BAA) deployment model.

## Status

- Branding config: `src/lib/product.ts` (name = Converge on this branch).
- Started Phase A: `src/lib/opportunity.ts` (net-realizable opportunity model).
