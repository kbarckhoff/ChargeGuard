# CMS Fee Schedule Refresh Pipeline

Keeps ChargeGuard's reference data (status indicators, APC payments, ASP limits,
retired codes) current with CMS releases — **auto-detect + download to staging +
you approve + promote**. Nothing overwrites the live reference without your sign-off.

Source list and cadence come from Greg's Maintenance Calendar (Formula Library Step 16).
v1 covers the three sources that power the current rules; more are listed (disabled)
in `sources.mjs` to switch on as parsers are confirmed.

## One-time setup

```powershell
cd "C:\Users\kbarc\OneDrive\Desktop\Himformatics\ChargeGuard\chargeguard"
npm install adm-zip
```

## The workflow

1. **Check + stage** (downloads newest CMS files, diffs vs live, never overwrites):
   ```powershell
   node scripts/fee-schedules/refresh.mjs
   ```
   First time, confirm the column mapping is reading the real files correctly:
   ```powershell
   node scripts/fee-schedules/refresh.mjs --inspect
   ```
   This prints the detected sheet + header row for each source. If a header looks
   wrong, tell Claude and the parser in `parsers.mjs` gets adjusted.

2. **Review** the deltas printed by step 1 (e.g. "NEW VERSION: staged Jul 2026, +142 codes").

3. **Approve** a source you've reviewed:
   ```powershell
   node scripts/fee-schedules/promote.mjs --source=opps_addendum_b
   ```

4. **Rebuild the engine reference** (merges promoted sources into the bundled JSON the scan uses; backs up the old one):
   ```powershell
   node scripts/fee-schedules/build-reference.mjs
   ```

5. **Restart the app** so the scan picks it up:
   ```powershell
   Remove-Item -Recurse -Force .next
   npm run dev
   ```

## Layout

- `sources.mjs` — registry (CMS landing URLs, cadence, which columns each feeds).
- `lib.mjs` — download/redirect, unzip, spreadsheet parsing, HCPCS normalization, manifest.
- `parsers.mjs` — per-source parsers (column detection by header name).
- `refresh.mjs` — discover → download → parse → stage → diff. **No auto-promote.**
- `promote.mjs` — copy a reviewed staging version to `data/cms-sources/live/`.
- `build-reference.mjs` — merge live sources into `src/lib/cms-reference-data.json`.
- `data/cms-sources/{staging,live,backups}/` + `manifest.json` — versioned data + history.

## Scheduling

`.github/workflows/fee-schedule-refresh.yml` runs the **check + stage** step on the
5th and 20th of Jan/Apr/Jul/Oct, uploads the staged data as an artifact, and opens
a GitHub issue when a new version is found. Promotion stays manual (your approval gate).

## Notes / known limits

- **Column mappings are best-effort** until confirmed against a real download — run
  `--inspect` first. CMS occasionally reshuffles columns; detection is by header name
  to be resilient, but verify on the first run.
- **AMA CPT** (annual code descriptions) is licensed/paywalled — not auto-downloadable;
  drop it in manually under your AMA license.
- **Retired detection**: `build-reference.mjs --apply-retired` will mark codes missing
  from the latest HCPCS active list as retired. Off by default until validated, since it
  changes existing flags.
- v1 is file-based; a Supabase-backed staging/version table is a future upgrade.
```
