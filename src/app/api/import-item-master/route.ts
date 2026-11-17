import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/active-org";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { isAuditLocked } from "@/lib/audit-lock";

export const maxDuration = 60;
const str = (v: any) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
const bool = (v: any) => (v === true || v === false ? v : null);

// Ingest the hospital item master (device / C-code / rev-code setup checks).
export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sessionClient = await createSessionClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { orgId } = await resolveActiveOrg(db, user.id);

    const { auditId, rows, replace = true } = await request.json();
    if (auditId && await isAuditLocked(db, auditId)) return NextResponse.json({ error: "This quarter is completed (locked)." }, { status: 409 });
    if (!auditId || !Array.isArray(rows)) return NextResponse.json({ error: "Missing auditId or rows" }, { status: 400 });

    const records = rows.map((r: any) => ({
      audit_id: auditId, org_id: orgId,
      item_number: str(r.item_number), description: str(r.description), hcpcs: str(r.hcpcs), rev_code: str(r.rev_code),
      c_code: str(r.c_code), is_device: bool(r.is_device), charge_code: str(r.charge_code), is_active: bool(r.is_active),
    })).filter((r: any) => r.item_number || r.hcpcs || r.description);

    if (records.length === 0) return NextResponse.json({ error: "No usable item rows" }, { status: 400 });
    if (replace) await db.from("item_master").delete().eq("audit_id", auditId);

    let inserted = 0;
    for (let i = 0; i < records.length; i += 1000) {
      const { error } = await db.from("item_master").insert(records.slice(i, i + 1000));
      if (error) return NextResponse.json({ error: error.message, insertedSoFar: inserted }, { status: 500 });
      inserted += Math.min(1000, records.length - i);
    }
    return NextResponse.json({ success: true, inserted });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
