// One-off + repeatable seeder: loads the bundled CMS reference JSON into the
// cms_reference table so runtime data matches the current bundled set. Safe to
// re-run (upsert on hcpcs). Reads creds from .env.local.
//   node scripts/seed-reference.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function env(name) {
  const raw = readFileSync(join(root, ".env.local"), "utf8");
  const m = raw.match(new RegExp(`^${name}=(.*)$`, "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
}

const url = env("NEXT_PUBLIC_SUPABASE_URL");
const key = env("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !key) { console.error("Missing Supabase env"); process.exit(1); }

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const data = JSON.parse(readFileSync(join(root, "src/lib/cms-reference-data.json"), "utf8"));
const keys = Object.keys(data);
console.log(`Seeding ${keys.length} reference codes...`);

const COLS = ["short_desc", "si", "apc_payment", "mc_fee", "mc_rvu", "pf_fee", "pf_rvu", "clfs", "asp", "dosage", "retired"];
let written = 0;
for (let i = 0; i < keys.length; i += 1000) {
  const batch = keys.slice(i, i + 1000).map((h) => {
    const r = data[h];
    const rec = { hcpcs: h };
    for (const c of COLS) rec[c] = r[c] ?? null;
    return rec;
  });
  const { error } = await db.from("cms_reference").upsert(batch, { onConflict: "hcpcs" });
  if (error) { console.error("Batch failed:", error.message); process.exit(1); }
  written += batch.length;
  process.stdout.write(`\r  ${written}/${keys.length}`);
}
console.log(`\nDone. ${written} rows upserted.`);
