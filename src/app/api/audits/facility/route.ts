import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Saves the facility type for a review. Drives which rules apply on the scan.
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { auditId, facilityType } = await request.json();
    const allowed = ["short_term_acute"];
    if (!auditId || !allowed.includes(facilityType)) {
      return NextResponse.json({ error: "auditId and a valid facilityType are required" }, { status: 400 });
    }

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await db.from("audits").update({ facility_type: facilityType }).eq("id", auditId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
