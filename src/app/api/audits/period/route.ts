import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { isAuditLocked } from "@/lib/audit-lock";

// Save the single "Review Date" (e.g. "Q1 2026", "H1 2026", "FY 2026") for an
// audit. Stored in audits.metadata.review_period; the trailing year drives the
// scan's effective-date filtering.
export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { auditId, reviewPeriod, lowVolumeThreshold } = await request.json();
    if (!auditId) return NextResponse.json({ error: "auditId is required" }, { status: 400 });
    if (await isAuditLocked(db, auditId)) {
      return NextResponse.json({ error: "This review is completed (locked)." }, { status: 409 });
    }

    const { data: audit } = await db.from("audits").select("metadata").eq("id", auditId).single();
    const metadata: Record<string, any> = { ...((audit?.metadata as any) || {}) };
    if (reviewPeriod !== undefined) metadata.review_period = String(reviewPeriod || "").trim() || null;
    if (lowVolumeThreshold !== undefined) {
      const n = Number(lowVolumeThreshold);
      metadata.low_volume_threshold = Number.isFinite(n) && n >= 0 ? n : null;
    }
    const { error } = await db.from("audits").update({ metadata }).eq("id", auditId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
