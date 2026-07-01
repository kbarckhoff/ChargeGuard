import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export const maxDuration = 60;

function pick(row: Record<string, any>, ...hints: string[]): any {
  const keys = Object.keys(row);
  for (const h of hints) {
    const k = keys.find((k) => k.toLowerCase().replace(/[\s_]/g, "").includes(h));
    if (k != null) return row[k];
  }
  return undefined;
}
const numOrNull = (v: any) => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? null : n; };

export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { data: userData } = await db.from("users").select("org_id").eq("id", user.id).single();
    if (!userData) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { auditId, rows, replace = true } = await request.json();
    if (!auditId || !Array.isArray(rows)) return NextResponse.json({ error: "Missing auditId or rows" }, { status: 400 });

    const records = rows.map((r: Record<string, any>) => ({
      audit_id: auditId, org_id: userData.org_id,
      charge_code: String(pick(r, "chargecode", "charge", "code") ?? "").trim() || null,
      status: String(pick(r, "status") ?? "").trim() || null,
      ndc: String(pick(r, "ndc") ?? "").trim() || null,
      drug_name: String(pick(r, "drugname", "name", "description") ?? "").trim() || null,
      pkg_amt: numOrNull(pick(r, "pkgamt", "packageamount", "pkgamount")),
      pkg_unit: String(pick(r, "pkgunit", "packageunit", "unit") ?? "").trim() || null,
    })).filter((r) => r.charge_code);

    if (records.length === 0) return NextResponse.json({ error: "No usable formulary rows (need a Charge Code column)" }, { status: 400 });

    if (replace) await db.from("charge_formulary").delete().eq("audit_id", auditId);
    let inserted = 0;
    for (let i = 0; i < records.length; i += 1000) {
      const batch = records.slice(i, i + 1000);
      const { error } = await db.from("charge_formulary").insert(batch);
      if (error) return NextResponse.json({ error: error.message, insertedSoFar: inserted }, { status: 500 });
      inserted += batch.length;
    }
    return NextResponse.json({ success: true, inserted });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
