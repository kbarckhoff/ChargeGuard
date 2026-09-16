import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Persist the competitor list for an audit in audits.metadata.competitors, so it
// is scoped per client/review and survives refresh. Not blocked by the intake
// lock — competitors can be added even after intake is locked (Peer Setup).
export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { auditId, competitors } = await request.json();
    if (!auditId) return NextResponse.json({ error: "auditId is required" }, { status: 400 });

    const clean = Array.isArray(competitors)
      ? competitors
          .map((c: any) => ({ n: String(c?.n || "").trim(), c: String(c?.c || "").trim() }))
          .filter((c: any) => c.n)
          .slice(0, 25)
      : [];

    const { data: audit } = await db.from("audits").select("metadata").eq("id", auditId).single();
    const metadata: Record<string, any> = { ...((audit?.metadata as any) || {}) };
    metadata.competitors = clean;
    const { error } = await db.from("audits").update({ metadata }).eq("id", auditId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
