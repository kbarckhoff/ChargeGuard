import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Start (or open) a quarter run for a hospital. One run per hospital per quarter:
// if a run already exists for that hospital + year + quarter, we return it instead
// of creating a duplicate. New runs start clean (all rules on, no competitors).
export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: userData } = await db.from("users").select("org_id").eq("id", user.id).single();
    if (!userData) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { hospital_name, name: rawName } = await request.json();
    const name = String(rawName || "").trim();
    if (!hospital_name || !name) {
      return NextResponse.json({ error: "hospital_name and name are required" }, { status: 400 });
    }

    // Reviews can be run as many times as needed, so a new run is always created;
    // it's identified by a free-text review name. Create a fresh, clean run.
    const { data: newId, error } = await db.rpc("create_audit_with_phases", {
      p_org_id: userData.org_id,
      p_name: name,
      p_hospital_name: hospital_name,
      p_description: null,
      p_lead_auditor_id: user.id,
      p_start_date: new Date().toISOString().split("T")[0],
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // ChargeGuard supports short-term acute care only; every review uses it.
    await db.from("audits").update({ status: "in_progress", facility_type: "short_term_acute" }).eq("id", newId);

    return NextResponse.json({ success: true, auditId: newId, existing: false });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
