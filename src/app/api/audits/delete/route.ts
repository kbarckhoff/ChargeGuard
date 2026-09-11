import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Permanently delete a quarter run and all of its data. Verifies the run belongs
// to the caller's org first. Children are removed before the audit row so foreign
// keys are satisfied.
const CHILD_TABLES = ["findings", "charge_items", "charge_usage", "charge_formulary", "claim_lines", "peer_prices", "audit_phases"];

export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: userData } = await db.from("users").select("org_id").eq("id", user.id).single();
    if (!userData) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { auditId } = await request.json();
    if (!auditId) return NextResponse.json({ error: "Missing auditId" }, { status: 400 });

    // Only allow deleting a run in the caller's own org.
    const { data: audit } = await db.from("audits").select("id, org_id").eq("id", auditId).single();
    if (!audit || audit.org_id !== userData.org_id) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    for (const t of CHILD_TABLES) {
      const { error } = await db.from(t).delete().eq("audit_id", auditId);
      if (error) return NextResponse.json({ error: `Failed clearing ${t}: ${error.message}` }, { status: 500 });
    }
    const { error: aErr } = await db.from("audits").delete().eq("id", auditId);
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
