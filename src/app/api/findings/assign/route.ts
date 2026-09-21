import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/roles";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

// Assign (or unassign) one or more findings to a user. Only the Charge Master
// Analyst or a Super User may assign. Writes an audit-log entry per finding.
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = admin();
    const actor = await getActor(db, user.id);
    if (!actor.canAssign) return NextResponse.json({ error: "Only a Charge Master Analyst or Super User can assign findings." }, { status: 403 });

    const body = await request.json();
    const ids: string[] = Array.isArray(body.findingIds) ? body.findingIds : (body.findingId ? [body.findingId] : []);
    const assigneeId: string | null = body.assignee_id || null;
    if (!ids.length) return NextResponse.json({ error: "No findings selected" }, { status: 400 });

    // Validate the assignee exists (when assigning, not clearing).
    if (assigneeId) {
      const { data: a } = await db.from("users").select("id").eq("id", assigneeId).maybeSingle();
      if (!a) return NextResponse.json({ error: "Unknown assignee" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const { error: uErr } = await db.from("findings")
      .update(assigneeId ? { assigned_to: assigneeId, assigned_by: user.id, assigned_at: now }
                         : { assigned_to: null, assigned_by: user.id, assigned_at: now })
      .in("id", ids);
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

    // Audit log: one row per finding.
    const { data: rows } = await db.from("findings").select("id, org_id, audit_id").in("id", ids);
    const activity = (rows || []).map((r: any) => ({
      org_id: r.org_id, audit_id: r.audit_id, finding_id: r.id, actor_id: user.id,
      action: assigneeId ? "assigned" : "unassigned", assignee_id: assigneeId,
    }));
    if (activity.length) await db.from("finding_activity").insert(activity);

    return NextResponse.json({ ok: true, count: ids.length });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
