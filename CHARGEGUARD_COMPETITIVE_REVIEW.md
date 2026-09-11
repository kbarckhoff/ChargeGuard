# ChargeGuard — Competitive Review & Roadmap
_Prepared August 2026_

## 1. What ChargeGuard is today

ChargeGuard is a working, deployed web app (Next.js + Supabase, live on Vercel) that reproduces a proven expert CDM-review methodology as a repeatable, multi-client engine. It imports a hospital's chargemaster plus Revenue & Usage and Formulary files, runs a rules engine against an auto-refreshing CMS reference layer, and generates the full deliverable workbook — verified to the reference review's exact numbers on the sample hospital ($257M gross CDM).

**What it detects automatically (verified against the reference expert review):**

- Status-indicator logic: bundled SI=B (321, exact), SI=Q1–Q4 packaging (2,185, ties to the penny), pass-through SI=J/K (924, exact), SI=A non-OPPS gaps
- Retired/deleted HCPCS (131, exact), new/recommended codes, vaccine admin G-codes
- Device-procedure crosswalk, both directions — I/OCE forward and Rev 278 reverse (360 lines, exact)
- Pricing: underpriced vs MPFS, outliers, zero-price, price variance
- Multi rev-code (850 unique HCPCS, exact), duplicate lines, add-on/modifier issues
- Pharmacy suite: inactive formulary (15, exact), NDC mismatch, UOM mismatch, billing-unit/multiplier ratio
- Price Transparency — the 70 CMS shoppable services (52 compliant / 1 unpriced / 17 not-in-CDM, exact)
- R&U-weighted financial impact with Medicare / MA payer mix

**Infrastructure differentiators already built:**

- An **auto-refreshing CMS fee-schedule pipeline** (OPPS Addendum B, MPFS, CLFS, ASP, HCPCS quarterly) with staging/diff/promote — ~21.5k codes, client-agnostic. This is the expensive, tedious part of maintaining a chargemaster tool, and it's automated.
- Auto-generated **Client Data Request Form** (75 items, owners, timing) and the full consultant-styled Excel deliverable.

**Honest gaps (from the coverage audit):** everything not yet covered is *data-gated*, not a logic gap — it needs a client file ChargeGuard doesn't ingest yet (12-month 837/claims for Modifier-25 / co-billing / CCR leakage; anesthesia base-unit file) or is a different engagement type (SNF/HHA/LTCH standalone facility modules).

---

## 2. The competitive landscape

The market splits into two tiers, and it matters which one you're competing in.

**Tier A — enterprise CDM/revenue-integrity platforms** (Craneware Trisus, Optum, FinThrive, PMMC, TruBridge). These are six-figure, multi-month-implementation SaaS platforms sold to health-system revenue-integrity departments. Craneware's Trisus Chargemaster was named 2026 Best in KLAS for the 15th time and was one of the first health-tech products to earn Microsoft AI for Healthcare certification. What defines this tier:

- **Bi-directional EHR / patient-accounting integration** — Craneware cites integration with 30+ systems (Epic, Cerner, MEDITECH). They don't just import a CDM export; they read and write back into the source system, eliminating dual maintenance.
- **Proprietary pricing-benchmark data** — peer, national, and state pricing. Optum sells peer pricing off the CMS Outpatient Standard Analytical File (OPSAF); FinThrive claims 550,000+ line-item coding/compliance/pricing benchmarks. This lets them say a price is "defensible vs. your peers," not just "vs. Medicare."
- **Continuous governance**, not a point-in-time review — ongoing monitoring, workflow, task assignment, audit trails, role-based access.
- **Proprietary content libraries** (UB editor e-books, best-practice catalogs) maintained by regulatory teams.

**Tier B — AI charge-capture / charge-integrity tools** (Waystar Charge Integrity, Health Catalyst VitalIntegrity, Jorie AI, RapidClaims). These work the *claims* side: process 837 files or itemized bills daily to find missing charges, under-coding, and denial risk before the claim goes out. Industry framing: hospitals lose an estimated **1–3% of gross revenue** to charge-capture problems. "AI-powered reconciliation, validated against a well-maintained CDM" is being called the 2026 standard of care.

**Where ChargeGuard sits:** it does the *CDM-side* analysis of Tier A extremely well — arguably as thoroughly as the flag logic in the big platforms — but it lacks their integration, benchmark data, and continuous-governance wrapper. It does not yet touch the claims side (Tier B) at all, though the methodology (the expert's Phase 2) is defined.

---

## 3. Honest gap analysis

| Capability | Big platforms | ChargeGuard | Gap severity |
|---|---|---|---|
| CDM flag/edit logic (SI, pricing, device, pharmacy, transparency) | ✅ | ✅ verified to consultant's exact numbers | **None — at parity** |
| Auto-refreshing CMS reference data | ✅ | ✅ built | **None** |
| Full consultant deliverable + data-request | Varies | ✅ | **ChargeGuard ahead** |
| Peer / national / state pricing benchmarks | ✅ core selling point | ❌ Medicare only | **High — top gap** |
| Claims/837 charge-capture & denial prevention | ✅ (Tier B) | ❌ (methodology defined) | **High** |
| Continuous monitoring / re-scan / alerting | ✅ | ❌ one-time run | **Medium-High** |
| Remediation workflow (assign, track, approve, audit trail) | ✅ | ❌ findings are read-only | **Medium** |
| EHR / patient-accounting write-back integration | ✅ (30+ systems) | ❌ CSV import/export | **Medium (hard, expensive)** |
| Multi-facility / location-specific coding, cost centers, shell codes | ✅ | ◑ single-workspace | **Medium** |
| AI-assisted edit explanation & suggested correction | Emerging | ❌ | **Medium (differentiator)** |
| Dashboards / reporting UI | ✅ | ◑ basic | **Low-Medium** |

---

## 4. Strategic read — where you can actually win

Do **not** try to out-platform Craneware. They have 15 years of KLAS wins, 30+ EHR integrations, and enterprise sales teams. Head-on is a losing fight for a solo build.

The opening is that the big platforms are **expensive, slow to implement, and priced for large health systems**. Two under-served segments fall through that gap:

1. **RCM consultants and boutique firms** (people who do exactly what the reference methodology does, by hand, in Excel). ChargeGuard is the productized version of their engagement — it turns a multi-week manual review into a same-day, reproducible, exactly-verifiable deliverable. That's a real product with a real buyer, and it's already built.
2. **Small and mid-size / critical-access hospitals** that can't justify a Craneware contract but still lose 1–3% of revenue to CDM problems. A fast, affordable "CDM health check" (one-time or quarterly) is a wedge the enterprise vendors don't serve well.

Your durable advantages: a **proven, defensible methodology verified to the penny**, an **already-automated CMS refresh pipeline** (the boring expensive part), and **low cost / fast turnaround**. Lead with "the automated version of a $30–60k consultant CDM review," not "a cheaper Craneware."

---

## 5. Prioritized roadmap

### Tier 1 — sharpen the wedge (highest ROI, mostly extends what exists)

1. **Peer pricing benchmarks.** This is the single biggest capability gap and the easiest credibility win. Ingest the CMS OPSAF / OPPS pricing files (public, and your refresh pipeline already handles CMS downloads) to show each charge vs. Medicare *and* vs. peer/CBSA pricing. Moves you from "underpriced vs. Medicare" to "defensible pricing" — the exact language the big vendors sell on.
2. **Claims / 837 import (the expert's Phase 2).** Unlocks Modifier-25 CCI co-billing, CCR leakage, missing-charge/under-coding detection. This is the door into the Tier B charge-capture story and roughly doubles the addressable findings. Methodology is already defined — it's data-gated, not logic-gated.
3. **Continuous / re-scan mode.** Let a client re-import next quarter and diff findings ("12 new flags, 40 resolved, $X recovered"). Turns a one-time report into a recurring subscription — the difference between a service and a product. You already have a scheduled-task capability to build on.

### Tier 2 — productize into a platform

4. **Remediation workflow.** Findings currently read-only — add assign / accept / reject / resolve with an audit trail and a "recovered $" tracker. This is what makes it defensible in an audit and sticky for teams.
5. **Multi-facility support.** Location-specific coding, cost-center rollups, and per-facility scoping so one login can run a health system, not just one hospital.
6. **Dashboards.** Recovered-dollars-over-time, findings-by-category trend, compliance posture — the executive view that sells renewals.

### Tier 3 — build a moat

7. **AI-assisted findings.** For each flag, generate a plain-English explanation + suggested correction + the CMS citation. Cheap to add given the data you already compute, and it's what "AI-certified" competitors are charging a premium for.
8. **EHR integration (later, deliberate).** Start read-only (pull the CDM via API instead of CSV) before attempting write-back. This is the expensive, slow capability — do it only once demand is proven.

---

## 6. Bottom line

ChargeGuard's *analytical core is already competitive* with the enterprise platforms — verified to a consultant's exact numbers, with the CMS-maintenance automation that's usually the hardest part. What it lacks is the commercial wrapper: benchmark pricing data, the claims-side story, continuous monitoring, and workflow.

The winning move is not to match Craneware feature-for-feature but to be **the automated, affordable, defensible CDM review** for consultants and mid-market hospitals the big vendors underserve. Tier 1 (peer pricing → claims import → re-scan mode) gets you most of the way there and builds on code you already have.

---

## Sources
- [The Craneware Group Named 2026 Best in KLAS for Trisus Chargemaster](https://www.thecranewaregroup.com/news-events/press-releases/2026/the-craneware-group-named-2026-best-in-klas-for-trisus-chargemaster/)
- [Optum Chargemaster Management Solutions](https://www.optumcoding.com/chargemaster-solutions/chargemaster-spotlight/)
- [FinThrive — CDM Management](https://finthrive.com/solutions/revenue-integrity/cdm-management)
- [5 leading hospital chargemaster software products — TechTarget](https://www.techtarget.com/revcyclemanagement/feature/leading-hospital-chargemaster-software-products)
- [Waystar — Charge Integrity](https://www.waystar.com/our-platform/revenue-capture/charge-integrity/)
- [Health Catalyst — VitalIntegrity charge capture](https://www.healthcatalyst.com/products/vitalintegrity)
- [Top 10 AI Healthcare Revenue Integrity Solutions for 2026 — CombineHealth](https://www.combinehealth.ai/blog/healthcare-revenue-integrity-solutions)
- [Jorie AI — AI-Driven Charge Capture](https://www.jorie.ai/post/how-ai-driven-charge-capture-boosts-healthcare-revenue-integrity)
