import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

// Update a member's department memberships and/or active status. Callers must be
// in the same org (or platform owner).
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = admin();
    const { data: me } = await db.from("users").select("org_id, is_platform_owner").eq("id", user.id).single();
    if (!me?.org_id) return NextResponse.json({ error: "No organization" }, { status: 404 });

    const { user_id, department_ids, is_active, app_role, department } = await request.json();
    if (!user_id) return NextResponse.json({ error: "Missing user_id" }, { status: 400 });

    const { data: target } = await db.from("users").select("id, org_id").eq("id", user_id).single();
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!me.is_platform_owner && target.org_id !== me.org_id) {
      return NextResponse.json({ error: "Not allowed" }, { status: 403 });
    }

    const userUpdates: Record<string, unknown> = {};
    if (typeof is_active === "boolean") userUpdates.is_active = is_active;
    if (["super_user", "analyst", "member"].includes(app_role)) userUpdates.app_role = app_role;
    if (typeof department === "string") userUpdates.department = department.trim() || null;
    if (Object.keys(userUpdates).length) {
      await db.from("users").update(userUpdates).eq("id", user_id);
    }

    if (Array.isArray(department_ids)) {
      await db.from("user_departments").delete().eq("user_id", user_id);
      if (department_ids.length) {
        await db.from("user_departments").insert(
          department_ids.map((d: string) => ({ user_id, department_id: d, org_id: target.org_id })),
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
