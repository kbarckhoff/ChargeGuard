// Merge all promoted (live) CMS sources into the engine's reference file
// (src/lib/cms-reference-data.json). Preserves the existing reference as a base
// and overlays each source's columns. Backs up the previous version first.
//
// Usage:  node scripts/fee-schedules/build-reference.mjs [--apply-retired]
import { join } from "node:path";
import { readdirSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { LIVE_DIR, readJsonIf, writeJson, readManifest } from "./lib.mjs";

const ROOT = process.cwd();
const ENGINE_JSON = join(ROOT, "src", "lib", "cms-reference-data.json");
const applyRetired = process.argv.includes("--apply-retired");

// base = current engine reference (preserves retired flags / any columns)
const base = readJsonIf(ENGINE_JSON) || {};
const merged = { ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, { ...v }])) };

if (!existsSync(LIVE_DIR)) { console.error("No live sources yet. Promote at least one first."); process.exit(1); }
const liveFiles = readdirSync(LIVE_DIR).filter((f) => f.endsWith(".json"));
if (liveFiles.length === 0) { console.error("No promoted sources in live/."); process.exit(1); }

let activeSet = null;
const applied = [];
for (const f of liveFiles) {
  const live = readJsonIf(join(LIVE_DIR, f));
  if (!live?.data) continue;
  let touched = 0;
  for (const [hcpcs, rec] of Object.entries(live.data)) {
    merged[hcpcs] = { ...(merged[hcpcs] || {}), ...rec };
    touched++;
  }
  if (live.activeCodes?.length) activeSet = new Set(live.activeCodes);
  applied.push(`${live.source} (${live.label}, ${touched} codes)`);
}

// Optionally recompute retired = code not in the current active HCPCS list
if (applyRetired && activeSet) {
  let flagged = 0;
  for (const [hcpcs, rec] of Object.entries(merged)) {
    const isAlpha = /^[A-Z]/.test(hcpcs);
    // only judge standard 5-char codes we'd expect in the HCPCS list
    if (!activeSet.has(hcpcs)) { rec.retired = "YES"; flagged++; }
    else if (rec.retired === "YES") delete rec.retired;
  }
  console.log(`Applied retired-from-active-list: ${flagged} codes flagged retired.`);
}

// backup previous engine json
if (existsSync(ENGINE_JSON)) {
  const backupDir = join(ROOT, "data", "cms-sources", "backups");
  mkdirSync(backupDir, { recursive: true });
  copyFileSync(ENGINE_JSON, join(backupDir, `cms-reference-data.${Date.now()}.json`));
}

writeJson(ENGINE_JSON, merged);
console.log(`✅ Rebuilt ${ENGINE_JSON}`);
console.log(`   sources applied: ${applied.join("; ")}`);
console.log(`   total codes in reference: ${Object.keys(merged).length}`);
console.log("   Rebuild the app (delete .next, npm run dev) so the scan picks up the new reference.");
