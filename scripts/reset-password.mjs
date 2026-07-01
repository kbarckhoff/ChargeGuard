// One-off admin password reset using the Supabase service-role key from .env.local.
// Usage:  node scripts/reset-password.mjs [email]
//   - if you pass an email, it resets that user
//   - if you omit it and there's exactly one user, it resets that one
//   - otherwise it lists the users so you can pick
// New password is set to: Password123
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const NEW_PASSWORD = "Password123";

// --- read .env.local (no extra deps) ---
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

const targetEmail = process.argv[2]?.toLowerCase();

const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (error) {
  console.error("Could not list users:", error.message);
  process.exit(1);
}
const users = data.users || [];
if (users.length === 0) {
  console.error("No users found in this project. Sign up first at /auth/signup.");
  process.exit(1);
}

let user;
if (targetEmail) {
  user = users.find((u) => (u.email || "").toLowerCase() === targetEmail);
  if (!user) {
    console.error(`No user with email ${targetEmail}. Users found:`);
    users.forEach((u) => console.error("  -", u.email));
    process.exit(1);
  }
} else if (users.length === 1) {
  user = users[0];
} else {
  console.error("Multiple users found — re-run with one of these emails as an argument:");
  users.forEach((u) => console.error("  -", u.email));
  process.exit(1);
}

const { error: updErr } = await admin.auth.admin.updateUserById(user.id, {
  password: NEW_PASSWORD,
});
if (updErr) {
  console.error("Reset failed:", updErr.message);
  process.exit(1);
}
console.log(`✅ Password for ${user.email} reset to: ${NEW_PASSWORD}`);
