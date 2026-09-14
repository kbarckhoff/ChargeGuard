import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

// Edit a change-log entry (new value / effective date) or void it. Scoped to the
// caller's org (platform owner may edit any).
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = admin();
    const { data: me } = await db.from("users").select("org_id, is_platform_owner").eq("id", user.id).single();
    if (!me?.org_id) return NextResponse.json({ error: "No organization" }, { status: 404 });

    const { id, new_value, effective_date, status } = await request.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const { data: row } = await db.from("cdm_change_log").select("id, org_id").eq("id", id).single();
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!me.is_platform_owner && (row as any).org_id !== me.org_id) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof new_value === "string") updates.new_value = new_value;
    if (typeof effective_date === "string") updates.effective_date = effective_date || null;
    if (status === "void") updates.status = "void";

    const { error } = await db.from("cdm_change_log").update(updates).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
