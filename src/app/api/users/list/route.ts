import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { resolveActiveOrg, listMemberOrgs } from "@/lib/active-org";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

// Active users in the current client, for the assignment picker. Includes the
// client's home users plus anyone granted shared access to it.
export async function GET() {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = admin();
    const { orgId } = await resolveActiveOrg(db, user.id);
    if (!orgId) return NextResponse.json({ users: [] });

    const [{ data: home }, { data: shares }] = await Promise.all([
      db.from("users").select("id, full_name, email, department, is_active").eq("org_id", orgId),
      db.from("org_members").select("user_id").eq("org_id", orgId),
    ]);
    const byId: Record<string, any> = {};
    for (const u of home || []) if ((u as any).is_active) byId[(u as any).id] = u;
    const extra = (shares || []).map((s: any) => s.user_id).filter((id: string) => !byId[id]);
    if (extra.length) {
      const { data: su } = await db.from("users").select("id, full_name, email, department, is_active").in("id", extra);
      for (const u of su || []) if ((u as any).is_active) byId[(u as any).id] = u;
    }
    const users = Object.values(byId).map((u: any) => ({ id: u.id, full_name: u.full_name || u.email, email: u.email, department: u.department || null }))
      .sort((a: any, b: any) => a.full_name.localeCompare(b.full_name));
    return NextResponse.json({ users });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
