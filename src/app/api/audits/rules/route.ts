import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { isAuditLocked } from "@/lib/audit-lock";

// Save the set of deactivated rule_ids for an audit. Empty array = all rules
// active. The scan reads audits.disabled_rules and skips these.
export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { auditId, disabledRules } = await request.json();
    if (!auditId || !Array.isArray(disabledRules)) {
      return NextResponse.json({ error: "Missing auditId or disabledRules" }, { status: 400 });
    }
    const clean = disabledRules.map((r) => String(r)).slice(0, 500);

    if (await isAuditLocked(db, auditId)) {
      return NextResponse.json({ error: "This quarter is completed (locked)." }, { status: 409 });
    }
    const { error } = await db.from("audits").update({ disabled_rules: clean }).eq("id", auditId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, count: clean.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
