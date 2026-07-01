# ChargeGuard Engine Build — Greg Brazzel Methodology (v1)

Built the core analysis engine by porting Greg's CDM review logic into the scan pipeline.

## What was added

**CMS reference layer** (Track A foundation)
- `data/cms_reference.csv` — 2,789 unique HCPCS codes with SI, APC payment, MC/PF fee schedule, CLFS, ASP, and retired flag. Starter set extracted from Greg's v9-3 Report ("Hospital CDM + All Flags" tab).
- `src/lib/cms-reference-data.json` — same data, bundled for the app (keyed by normalized HCPCS).
- `src/lib/cms-reference.ts` — HCPCS normalization (Formula Library Step 1) + `getReference()` lookup.

**Reference-driven rules** (new flags)
- `src/lib/cdm-reference-rules.ts` — `runReferenceRules()` implementing:
  - Step 8 — SI=B Bundled (`8.B`)
  - Step 8 — SI=Q1–Q4 Conditional Packaging (`8.Q`)
  - Step 15 — Pass-through SI=J1/J2/K/K1/G/H + >3× ASP price audit (`15`, `15.ASP`)
  - Step 12 — Retired HCPCS (`12`)
  - Underpriced vs Medicare fee schedule (`U`)
  - Step 10 — Bilateral (Mod-50) 1.75× pricing + missing RT/LT (`10`, `10.B`)
  - Rev Code 637 — Self-Administered Drugs, Item 10 (`637`) — 700 lines, matches Greg's report exactly

**Wiring**
- `scan-route-v2.ts` — imports and runs `runReferenceRules` alongside the existing structural rules; `ruleToPhase` extended for the new rule prefixes.
- `route.ts` — now delegates to the v2 engine (original engine preserved as `route-v1-backup.ts.bak`).

## Verification against Greg's v9-3 Report (sample CDM, 8,080 lines)

| Flag | Engine | Greg's report | Result |
|------|--------|---------------|--------|
| SI=B Bundled | 321 | 321 | match |
| SI=Q1–Q4 Packaging | 2,185 | 2,185 | match |
| Pass-through SI=J/K/G | 924 | 924 | match |
| Retired HCPCS (lines) | 131 | 131 | match |
| Bilateral missing RT/LT | 51 | 52 | 1 boundary case |

TypeScript: new modules compile clean; full integrated route parses with no syntax errors.

## Notes / next steps
- The bilateral 1.75× *ratio* check (`10`) needs a real CDM import with separate RT/LT/50 lines and multiple modifier columns to fully engage; the single-modifier sample under-exercises it (the missing-RT/LT detection already matches Greg at 51 vs 52).
- Reference set is a starter extracted from one client's report. To make it client-agnostic, replace `cms_reference.csv` with full CMS source files (CPT Addendum B, OPPS Addendum A, MPFS, CLFS, ASP, NDC/C-code crosswalk) — same columns, more rows.
- Not yet ported (documented in ENGINE_PORTING_PLAN.md): vaccine G-code recoding (2b), device C-code/Rev278 crosswalk (2c), anesthesia (4), pharmacy NDC chain (5), billing-unit multiplier (7), Modifier-25 CCI (13b, needs claims), CCR leakage (15 Phase 2, needs claims), standalone facility types (18–24).
