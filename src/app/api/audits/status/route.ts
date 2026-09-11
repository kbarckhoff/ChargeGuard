import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Mark a quarter run complete (locked, read-only snapshot) or reopen it (active).
export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { auditId, status } = await request.json();
    if (!auditId || !["active", "completed"].includes(status)) {
      return NextResponse.json({ error: "auditId and status ('active'|'completed') required" }, { status: 400 });
    }
    // Map the UI's friendly status to the audit_status enum
    // ('draft','in_progress','on_hold','completed','archived').
    const dbStatus = status === "completed" ? "completed" : "in_progress";
    const { error } = await db.from("audits").update({ status: dbStatus }).eq("id", auditId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, status: dbStatus });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
