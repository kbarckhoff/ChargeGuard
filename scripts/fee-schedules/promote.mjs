// Promote a reviewed staging version to "live" (the approval gate).
// Usage:
//   node scripts/fee-schedules/promote.mjs --source=opps_addendum_b
//   node scripts/fee-schedules/promote.mjs --source=asp_pricing --version=20262
import { join } from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { STAGING_DIR, LIVE_DIR, readManifest, writeManifest, writeJson, readJsonIf, quarterLabel } from "./lib.mjs";

const args = process.argv.slice(2);
const key = args.find((a) => a.startsWith("--source="))?.split("=")[1];
const version = args.find((a) => a.startsWith("--version="))?.split("=")[1];
if (!key) { console.error("Pass --source=<key>"); process.exit(1); }

const dir = join(STAGING_DIR, key);
if (!existsSync(dir)) { console.error(`No staged data for ${key}. Run refresh.mjs first.`); process.exit(1); }
const ranks = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => parseInt(f));
const rank = version ? parseInt(version) : Math.max(...ranks);
const staged = readJsonIf(join(dir, `${rank}.json`));
if (!staged) { console.error(`No staged file for rank ${rank}.`); process.exit(1); }

writeJson(join(LIVE_DIR, `${key}.json`), staged);
const manifest = readManifest();
manifest.sources[key] = {
  ...(manifest.sources[key] || {}),
  liveRank: rank, liveLabel: quarterLabel(rank), promotedAt: new Date().toISOString(),
  rowCount: Object.keys(staged.data || {}).length,
};
writeManifest(manifest);

console.log(`✅ Promoted ${key} → ${quarterLabel(rank)} (${Object.keys(staged.data || {}).length} codes).`);
console.log("   Now rebuild the engine reference: node scripts/fee-schedules/build-reference.mjs");
