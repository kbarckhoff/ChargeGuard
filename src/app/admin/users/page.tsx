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
    users = data || [];
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
