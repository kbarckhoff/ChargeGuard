# CONVERGE / ChargeGuard standalone engine

This is the installable, offline version of the ChargeGuard rule engine. It runs
the **same rule library as the hosted app** (shared code in `src/lib`), but with
no website, no database, and no network. Point it at a folder of client files and
it writes the findings to a local folder. Nothing leaves the machine, which is
what makes it safe to run inside a client's own environment.

## Run it

```bash
npx tsx engine/run.ts --in <input-folder> --out <output-folder>
```

- `--in` folder should contain CSVs (names matched loosely, headers auto-mapped):
  - `*CDM*.csv` (required) — the chargemaster
  - `*RU*.csv` (optional) — utilization & actual charges
  - `*Formulary*.csv` (optional) — pharmacy formulary
- `--out` folder gets `findings.json` and `findings.csv`.

Example: `npx tsx engine/run.ts --in data/test-client --out engine/output`

## How it stays in sync with the app

The structural rules live in `src/lib/structural-rules.ts` and the reference /
pricing / coding rules in `src/lib/cdm-reference-rules.ts` (and peers, pharmacy,
device-crosswalk). Both the web app and this engine import those same files, so a
rule change lands in both. CMS reference data is bundled (`cms-reference-data.json`),
so the engine is fully self-contained and runs offline.

## Status

- Runs the full CDM + R&U + Formulary rule set offline. Verified on the sample
  hospital (8,082 lines) and a differently-formatted file (Northlake, 2,268 lines).
- Next steps toward the full CONVERGE spec: package to a double-click app / container,
  add the 835/837 claims+remittance ingestion and the cross-file joins, and the
  opportunity model + exec outputs.
- Cleanup owed: the scan route still carries its own copy of `runRules`; point it at
  `src/lib/structural-rules.ts` so there is a single source of truth.
