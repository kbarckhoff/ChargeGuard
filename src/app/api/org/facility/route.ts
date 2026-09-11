import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Saves the facility type once at the entity (organization) level. New reviews
// inherit it, so it isn't picked each time. Stored in organizations.settings
// (JSONB) so no schema change is needed. Drives which rules apply on the scan.
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { facilityType } = await request.json();
    const allowed = ["opps_outpatient", "short_term_acute", "inpatient", "snf"];
    if (!allowed.includes(facilityType)) {
      return NextResponse.json({ error: "A valid facilityType is required" }, { status: 400 });
    }

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: profile } = await db.from("users").select("org_id").eq("id", user.id).single();
    if (!profile?.org_id) return NextResponse.json({ error: "No organization" }, { status: 404 });

    const { data: org } = await db.from("organizations").select("settings").eq("id", profile.org_id).single();
    const settings = { ...(org?.settings || {}), facility_type: facilityType };
    const { error } = await db.from("organizations").update({ settings }).eq("id", profile.org_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
