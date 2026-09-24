import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

// Remediation step. The assignee has keyed the accepted change into the live
// CDM/EHR and is marking their Work Queue task done. This:
//   • sets the finding to "resolved" (done),
//   • flips the linked change-log entry to "implemented" (claimed done, awaiting
//     confirmation on the next CDM upload), stamping who completed it and when,
//   • writes a finding_activity audit row.
// A later run's smart-sync reconcile confirms it ("verified") or, if the value
// isn't found, flags it "not confirmed" (approved_missing).
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { findingId, note } = await request.json();
    if (!findingId) return NextResponse.json({ error: "Missing findingId" }, { status: 400 });

    const db = admin();
    const now = new Date().toISOString();

    const { data: f } = await db.from("findings").select("id, org_id, audit_id, status").eq("id", findingId).single();
    if (!f) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

    // Finding → resolved (work complete).
    const { error: fErr } = await db.from("findings")
      .update({ status: "resolved", resolved_at: now, resolved_by: user.id, ...(typeof note === "string" && note.trim() ? { resolution_note: note.trim() } : {}) })
      .eq("id", findingId);
    if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });

    // Change-log entry → implemented (claimed done, awaiting next-run confirmation).
    await db.from("cdm_change_log")
      .update({ status: "implemented", completed_by: user.id, implemented_at: now, updated_at: now })
      .eq("source_finding_id", findingId)
      .in("status", ["pending", "exported", "approved_missing"]);

    // Audit trail (best-effort).
    try {
      await db.from("finding_activity").insert({
        org_id: (f as any).org_id, audit_id: (f as any).audit_id, finding_id: findingId,
        actor_id: user.id, action: "implemented",
        note: typeof note === "string" ? (note.trim() || null) : null,
      });
    } catch { /* best-effort */ }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
