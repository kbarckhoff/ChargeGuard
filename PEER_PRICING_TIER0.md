# Peer Pricing Benchmark (Tier 0) — how to load and run

This adds a "priced vs. peer hospitals" comparison to the scan, using the free
public CMS **Medicare Outpatient Hospitals – by Geography and Service** file.
It compares each priced CDM line's gross charge to the average submitted charge
other OPPS hospitals report for the same HCPCS (national, or the client's state).

Findings land in a new category, **Pricing Benchmark (Peer Comparison)**, and
flow automatically into Findings, the dashboard, and the Excel deliverable (its
own tab + the Executive Summary + the master flags tab).

Until you load the data (step 1–3), the rule simply produces nothing — the app
runs exactly as before.

## What's already built
- `src/lib/pricing-benchmark.ts` — lookup layer (`getBenchmark`)
- `src/lib/pricing-benchmark-data.json` — data file (ships empty; you fill it)
- `runBenchmarkRules` in `src/lib/cdm-reference-rules.ts` — the flag logic
- wired into `src/app/api/scan/scan-route-v2.ts`
- `scripts/fee-schedules/build-benchmark.mjs` — the data builder

## Step 1 — download the CMS file (once per year)
1. Go to data.cms.gov → **Medicare Outpatient Hospitals** (Provider Summary by Type of Service).
2. Open the **"by Geography and Service"** dataset, pick the latest year.
3. Download the **CSV**.
4. Save it into the project at `data/cms-sources/benchmark/` (create the folder if needed).

## Step 2 — confirm the columns parse (optional but recommended)
From the project root (`ChargeGuard\chargeguard`):

```powershell
node scripts/fee-schedules/build-benchmark.mjs "data/cms-sources/benchmark\<the-file>.csv" --inspect
```

It prints the detected header and which columns it mapped to hcpcs / charge /
state / services. If it says all required columns were found, continue.

## Step 3 — build the benchmark
```powershell
node scripts/fee-schedules/build-benchmark.mjs "data/cms-sources/benchmark\<the-file>.csv"
```

This writes `src/lib/pricing-benchmark-data.json` (national + per-state average
charges per HCPCS) and backs up the previous version.

## Step 4 — rebuild and re-scan
```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run dev
```

Then re-run a scan on an audit. New peer-pricing findings will appear.

## Optional — benchmark against the client's state
The rule uses the national average by default. If you record a 2-letter state
on the audit (a `state` column on the `audits` table), the scan automatically
benchmarks against that state instead. No state = national.

## Tuning
Thresholds live at the top of `runBenchmarkRules` in `cdm-reference-rules.ts`:
- `BM_LOW = 0.75` — flag lines priced below 75% of the peer average (revenue opportunity)
- `BM_HIGH = 3.0` — flag lines priced above 3× the peer average (over-market / transparency risk)

## Notes / limits (Tier 0)
- This is Medicare fee-for-service charge data — a real, defensible peer benchmark,
  but it reflects the Medicare population, not commercial rates.
- It only covers HCPCS paid under OPPS, so supplies/drugs outside that file
  aren't benchmarked (by design — keeps the flags targeted).
- Percentiles (25th/50th/75th/90th) are a future enhancement using the larger
  "by Provider and Service" file; Tier 0 uses averages.
