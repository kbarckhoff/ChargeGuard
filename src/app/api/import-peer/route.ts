import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/active-org";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { isAuditLocked } from "@/lib/audit-lock";

export const maxDuration = 60;

const numOrNull = (v: any) => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
};

export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { orgId: __org } = await resolveActiveOrg(db, user.id);
    const userData = { org_id: __org };
    if (!userData) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { auditId, competitor, rows } = await request.json();
    if (!auditId || !competitor || !Array.isArray(rows)) {
      return NextResponse.json({ error: "Missing auditId, competitor, or rows" }, { status: 400 });
    }

    // Normalize the competitor name so "Mercy " and "Mercy" (or double spaces)
    // can't split one competitor into two and inflate the comparison.
    const name = String(competitor).trim().replace(/\s+/g, " ");
    if (!name) return NextResponse.json({ error: "Competitor name is empty" }, { status: 400 });

    if (await isAuditLocked(db, auditId)) {
      return NextResponse.json({ error: "This quarter is completed (locked)." }, { status: 409 });
    }

    const records = rows
      .map((r: any) => ({ audit_id: auditId, org_id: userData.org_id, competitor: name, hcpcs: String(r.hcpcs || "").trim(), gross_charge: numOrNull(r.gross) }))
      .filter((r: any) => r.hcpcs && r.gross_charge);

    if (records.length === 0) return NextResponse.json({ error: "No usable price rows (need HCPCS + gross charge)" }, { status: 400 });

    // Replace this competitor's prices for the audit
    await db.from("peer_prices").delete().eq("audit_id", auditId).eq("competitor", name);

    let inserted = 0;
    for (let i = 0; i < records.length; i += 1000) {
      const batch = records.slice(i, i + 1000);
      const { error } = await db.from("peer_prices").insert(batch);
      if (error) return NextResponse.json({ error: error.message, insertedSoFar: inserted }, { status: 500 });
      inserted += batch.length;
    }
    return NextResponse.json({ success: true, inserted, competitor: name });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}

// Remove all stored prices for one competitor (used to clear stale/orphaned
// competitor data so the peer comparison only reflects the intended files).
export async function DELETE(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { auditId, competitor } = await request.json();
    if (!auditId || !competitor) return NextResponse.json({ error: "Missing auditId or competitor" }, { status: 400 });

    const { error, count } = await db.from("peer_prices").delete({ count: "exact" }).eq("audit_id", auditId).eq("competitor", String(competitor));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, deleted: count || 0 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
