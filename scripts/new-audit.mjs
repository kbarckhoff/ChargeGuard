// Creates a fresh, empty audit (with phases) so you can import a CDM into a clean slate.
// Usage:  node scripts/new-audit.mjs ["Audit Name"] ["Hospital Name"]
// Defaults: "Greg CDM Validation" / "Greg Sample Hospital"
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const NAME = process.argv[2] || "Greg CDM Validation";
const HOSPITAL = process.argv[3] || "Greg Sample Hospital";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// find the user + org
const { data: list, error: lerr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (lerr) { console.error("listUsers failed:", lerr.message); process.exit(1); }
const user = list.users?.[0];
if (!user) { console.error("No users found. Sign up first."); process.exit(1); }

const { data: urow, error: uerr } = await admin
  .from("users").select("org_id").eq("id", user.id).single();
if (uerr || !urow) { console.error("Could not read org for user:", uerr?.message); process.exit(1); }

const { data, error } = await admin.rpc("create_audit_with_phases", {
  p_org_id: urow.org_id,
  p_name: NAME,
  p_hospital_name: HOSPITAL,
  p_description: "Cross-reference test against Greg Brazzel v9-3 report",
  p_lead_auditor_id: user.id,
  p_start_date: new Date().toISOString().split("T")[0],
});
if (error) { console.error("create_audit_with_phases failed:", error.message); process.exit(1); }

console.log(`✅ Created audit "${NAME}" (id: ${data}) for ${user.email}.`);
console.log("   It is now the most-recent audit, so Charge Master + Dashboard will use it.");
console.log("   Next: refresh Charge Master, Import CSV (Greg_CDM_for_import.csv), then Scan from the Dashboard.");
