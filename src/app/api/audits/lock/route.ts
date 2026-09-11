import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Locks (or reopens) the intake portion of a review. Once the client finishes
// Intake -> Imports -> Review Imports (everything up to Peer Setup), the review
// is locked so the profile, files, competitors, and rules can't be changed.
// Stored as audits.metadata.intake_locked (JSONB) so no schema change is needed.
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { auditId, locked } = await request.json();
    if (!auditId) return NextResponse.json({ error: "auditId required" }, { status: 400 });

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: audit } = await db.from("audits").select("metadata").eq("id", auditId).single();
    const metadata = { ...((audit?.metadata as any) || {}), intake_locked: locked !== false };
    const { error } = await db.from("audits").update({ metadata }).eq("id", auditId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, locked: metadata.intake_locked });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
