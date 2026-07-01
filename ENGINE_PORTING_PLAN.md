# ChargeGuard — Porting Greg's CDM Methodology into the Analysis Engine

Goal: make ChargeGuard reproduce Greg Brazzel's CDM review on any client's chargemaster.
Source of truth: `Greg Brazzel CDM\CDM_Formula_Library.xlsx` (24 steps), `CDM_Analysis_Replication_Guide.docx`, `CDM_Analysis_Report_v9-3.xlsx` (32 tabs / 26 flags), `CDM_Review_Dictionary_Reference.xlsx`.

## How the engine works today
`src/app/api/scan/scan-route-v2.ts` runs self-contained rules over imported `ChargeItem` rows and writes `Finding` rows. It already uses Greg's rule numbering. Current coverage:

| Rule | What it checks | Greg step |
|------|----------------|-----------|
| S.2 | Missing revenue code | 14 Validation |
| S.3 | Vague/missing description | 1 Header |
| S.4 | Rev code requires HCPCS, none present | 13 Modifier-RevCode |
| 6.5 | Zero / missing price | 14d |
| 6.6 | Price outlier vs rev-family median | 9 Price Variance |
| 1.3 | Rev code ↔ CPT mismatch | 13 |
| 1.7 / 1.8 / 1.9 | DME / blood / implant rev-code mapping | (keyword heuristics) |
| 1.11 | Duplicate charge lines | 11 Duplicate |
| 2.1 | Possible non-billable item | 14 |
| 2.4 | Hard-coded modifier (26/TC/50) | 13 |
| 3.2 | Price variance across same code | 9 |
| 3.3 | Unlisted code → seek specific alternative | 12-ish |
| R1 / R4 | Radiology modifier missing/incorrect | 13 |
| A1 | Add-on code without primary | (CCI) |
| L1 / L2 | Lab panel/component bundling + leakage | (panel logic) |

These are all **structural / within-CDM** rules — they need no external data.

## What Greg's method adds (the gaps)
Greg's highest-dollar flags are **status-indicator (SI) driven** and depend on CMS reference data joined onto each HCPCS. From the Formula Library + Report:

| Greg step / flag | What it does | Sample-client $ | Needs reference data |
|---|---|---|---|
| 8 — SI=B Bundled | Codes Medicare bundles (never paid separately) | 321 lines / $7.01M | CPT Addendum B (SI) |
| 8 — SI=Q1–Q4 Packaging | Conditionally packaged codes | 2,185 lines / $77.84M | Addendum B (SI) |
| 15 — Pass-Through SI=J1/J2/K/K1 | C-APC + pass-through drugs/biologicals | 920 lines / $35.23M | Addendum B (SI) |
| 2 — CPT/MPFS lookups | Short desc, SI, APC, APC payment, MC/PF fee | (feeds everything) | Addendum A/B, MPFS |
| 2b — Vaccine admin G-codes | G0008/9/10 vs 90471 underpayment | ~$3K/yr uplift | MPFS locality rates |
| 2c — Device C-code crosswalk | Rev 278 device lines missing C-codes (I/OCE reject risk) | 360 lines / $13.17M | C-code crosswalk |
| 3 — CLFS / ASP lookups | Lab fee schedule + Part B ASP limits | — | CLFS, ASP files |
| 4 — Anesthesia calc | Base units × locality CF | — | Anesthesia CF |
| 5 — Pharmacy NDC chain | NDC→HCPCS crosswalk, dose split | — | NDC crosswalk, formulary |
| 7 — Billing unit / multiplier | UOM parse + HCPCS Multiplier audit (e.g. J1885 60mg=4 units; underbilling) | — | NDC billing-unit file |
| 10 — Bilateral 1.75x | Mod-50 should price 1.75× unilateral; missing RT/LT | 685 lines / $10.82M | self-contained |
| 12 — Retired HCPCS | Code not in current-year CPT list + replacement | 78 codes | current CPT list |
| 13b — Modifier 25 CCI | Mod-25 on E/M when E/M + injection co-bill | — | needs claims (Phase 1.5) |
| 14d — Zero-price categories | Classify $0 lines (dose variants, NOS, global-package) | — | self-contained |
| 15 — CCR leakage (Phase 2) | (Item cost × CCR) − APC reimbursement | pending | needs 13X claims + CCR |
| 18–24 — Standalone facility types | SNF/HHA/LTCH/IRF/IPF/ASC/REH payment models | — | per-type fee schedules |

## The key architectural decision
Greg's big-dollar flags (SI=B, SI=Q1–Q4, pass-through, APC payment, retired-HCPCS, vaccine, device C-codes, CLFS/ASP) all require a **CMS reference-data layer** that ChargeGuard does not yet have. The `ChargeItem` model already has the destination fields (`apc_payment`, `apc_status`, `market_price`, etc.) but nothing populates them.

So v1 has two possible starting points:

- **Track A — build the reference layer first.** Load CMS Addendum A/B (SI + APC payment), MPFS, CLFS, ASP, and an NDC/C-code crosswalk into Supabase; normalize HCPCS on import (Greg step 1) and join. This unlocks the SI flags that represent the overwhelming majority of the dollars ($120M+ in the sample). Bigger lift; requires the CMS source files.
- **Track B — add the self-contained rules first.** Bilateral 1.75× (step 10), billing-unit/multiplier audit (step 7), zero-price categorization (14d), tighter duplicate/variance. Fast, no external data, but lower analytical value.

Recommendation: **Track A** — it's what actually makes ChargeGuard "reproduce Greg's review." Track B rules can be layered in alongside.

## Open question for Track A
Need the CMS reference files Greg's formulas point to (CPT Addendum B, OPPS Addendum A, MPFS, CLFS, ASP, NDC/C-code crosswalk). Either locate them on disk, or extract the SI/APC columns already joined into the v9-3 Report as a starter reference set.
