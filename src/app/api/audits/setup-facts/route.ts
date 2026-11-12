import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { resolveActiveOrg } from "@/lib/active-org";

export const runtime = "nodejs";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

// Save the CONVERGE setup-questionnaire facts onto audits.metadata.setup_facts.
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = admin();
    const { orgId } = await resolveActiveOrg(db, user.id);

    const { auditId, facts } = await request.json();
    if (!auditId || typeof facts !== "object") return NextResponse.json({ error: "auditId and facts are required" }, { status: 400 });

    const { data: a } = await db.from("audits").select("id, metadata").eq("id", auditId).eq("org_id", orgId).maybeSingle();
    if (!a) return NextResponse.json({ error: "Review not found" }, { status: 404 });

    const metadata = { ...((a as any).metadata || {}), setup_facts: facts };
    const { error } = await db.from("audits").update({ metadata }).eq("id", auditId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
