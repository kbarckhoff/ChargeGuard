import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import referenceData from "@/lib/cms-reference-data.json";

// One-off seeder: loads the bundled CMS reference JSON into cms_reference so the
// runtime table matches the current bundled set. Runs on the app server (which
// can reach Supabase). Guarded: dev-only unless CRON_SECRET is supplied.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const COLS = ["short_desc", "si", "apc_payment", "mc_fee", "mc_rvu", "pf_fee", "pf_rvu", "clfs", "asp", "dosage", "retired"] as const;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const ok = process.env.NODE_ENV !== "production" || (secret && url.searchParams.get("secret") === secret);
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const data = referenceData as Record<string, any>;
  const keys = Object.keys(data);
  let written = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000).map((h) => {
      const r = data[h];
      const rec: Record<string, any> = { hcpcs: h };
      for (const c of COLS) rec[c] = r[c] ?? null;
      return rec;
    });
    const { error } = await db.from("cms_reference").upsert(batch, { onConflict: "hcpcs" });
    if (error) return NextResponse.json({ error: error.message, writtenSoFar: written }, { status: 500 });
    written += batch.length;
  }

  // Seed the source metadata rows from the registry vintages.
  return NextResponse.json({ ok: true, written, total: keys.length });
}
