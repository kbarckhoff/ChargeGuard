import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { AdminTabs } from "@/components/admin/AdminTabs";

// Users & Roles for the active client. Super User (platform owner) manages who
// has access, their role, and their department (department is display-only).
export default async function AdminUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { orgId } = await resolveActiveOrg(db, user!.id);
  const { data: org } = orgId ? await db.from("organizations").select("name").eq("id", orgId).single() : { data: null as any };

  let users: any[] = [];
  if (orgId) {
    const { data } = await db
      .from("users")
      .select("id, full_name, email, app_role, department, is_active, is_platform_owner")
      .eq("org_id", orgId)
      .order("full_name");

    // last_seen_at is fetched separately and defensively: if the column hasn't
    // been migrated yet, supabase-js returns an error (it doesn't throw), so
    // this simply leaves the map empty instead of breaking the user list.
    const seenById: Record<string, string> = {};
    try {
      const { data: seen } = await db.from("users").select("id, last_seen_at").eq("org_id", orgId);
      for (const s of seen || []) if ((s as any).last_seen_at) seenById[(s as any).id] = (s as any).last_seen_at;
    } catch { /* column not present yet */ }

    // From Supabase Auth: last_sign_in_at (credential sign-ins only) and our
    // app_metadata.last_seen_at activity stamp (see lib/last-seen.ts), which
    // works with or without the users.last_seen_at migration.
    const lastLogin: Record<string, string> = {};
    const authSeen: Record<string, string> = {};
    try {
      for (let page = 1; page <= 25; page += 1) {
        const { data: al } = await db.auth.admin.listUsers({ page, perPage: 200 });
        const list = al?.users || [];
        for (const au of list) {
          if (au.last_sign_in_at) lastLogin[au.id] = au.last_sign_in_at;
          const s = (au.app_metadata as any)?.last_seen_at;
          if (typeof s === "string") authSeen[au.id] = s;
        }
        if (list.length < 200) break;
      }
    } catch { /* best-effort; column just shows "—" if unavailable */ }

    // Show the most recent of the auth sign-in and both activity stamps, so an
    // actively-logged-in user (long-lived session) reads as recent, not stale.
    const latest = (...vals: (string | null | undefined)[]) => {
      const t = Math.max(0, ...vals.map((v) => (v ? Date.parse(v) || 0 : 0)));
      return t ? new Date(t).toISOString() : null;
    };
    users = (data || []).map((u: any) => ({ ...u, last_login: latest(lastLogin[u.id], seenById[u.id], authSeen[u.id]) }));
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <h1 className="text-xl font-semibold text-[#0f172a] mb-4">Admin</h1>
        <AdminTabs />
        <p className="text-sm text-[#64748b] mb-6">Add people to {org?.name || "this client"}, set their role, and record their department. The Charge Master Analyst can assign findings to anyone here.</p>
        <AdminUsers users={users} />
      </div>
    </div>
  );
}
