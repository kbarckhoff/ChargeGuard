import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { isAuditLocked } from "@/lib/audit-lock";

export const maxDuration = 60;

const num = (v: any) => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
};
const str = (v: any) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const sessionClient = await createSessionClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: userData } = await supabaseAdmin.from("users").select("org_id").eq("id", user.id).single();
    if (!userData) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { auditId, rows, replace = true } = await request.json();
    if (auditId && await isAuditLocked(supabaseAdmin, auditId)) {
      return NextResponse.json({ error: "This quarter is completed (locked)." }, { status: 409 });
    }
    if (!auditId || !Array.isArray(rows)) {
      return NextResponse.json({ error: "Missing auditId or rows" }, { status: 400 });
    }

    const records = rows
      .map((r: any) => ({
        audit_id: auditId,
        org_id: userData.org_id,
        claim_id: str(r.claim_id),
        patient_acct: str(r.patient_acct),
        rev_code: str(r.rev_code),
        hcpcs: str(r.hcpcs),
        mod1: str(r.mod1), mod2: str(r.mod2), mod3: str(r.mod3), mod4: str(r.mod4),
        units: num(r.units),
        line_charge: num(r.line_charge),
        service_date: str(r.service_date),
        pos: str(r.pos),
        dx_primary: str(r.dx_primary),
      }))
      .filter((r: any) => r.hcpcs || r.rev_code);

    if (records.length === 0) {
      return NextResponse.json({ error: "No usable claim lines (need a HCPCS or revenue code)" }, { status: 400 });
    }

    if (replace) await supabaseAdmin.from("claim_lines").delete().eq("audit_id", auditId);

    let inserted = 0;
    for (let i = 0; i < records.length; i += 1000) {
      const batch = records.slice(i, i + 1000);
      const { error } = await supabaseAdmin.from("claim_lines").insert(batch);
      if (error) return NextResponse.json({ error: error.message, insertedSoFar: inserted }, { status: 500 });
      inserted += batch.length;
    }

    return NextResponse.json({ success: true, inserted });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
