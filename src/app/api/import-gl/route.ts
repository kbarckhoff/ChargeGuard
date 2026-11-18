import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/active-org";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { isAuditLocked } from "@/lib/audit-lock";

export const maxDuration = 60;
const str = (v: any) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };

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
      gl_number: str(r.gl_number), department_name: str(r.department_name), charge_prefix: str(r.charge_prefix), cost_center: str(r.cost_center),
    })).filter((r: any) => r.gl_number || r.department_name);

    if (records.length === 0) return NextResponse.json({ error: "No usable GL/department rows" }, { status: 400 });
    if (replace) await db.from("gl_departments").delete().eq("audit_id", auditId);

    const { error } = await db.from("gl_departments").insert(records);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, inserted: records.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
