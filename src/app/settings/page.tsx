import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { Badge } from "@/components/ui/shared";
import { TeamManager } from "@/components/settings/TeamManager";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("users").select("*, organizations(*)").eq("id", user!.id).single();

  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  // Team is scoped to the client currently being viewed (active org), so that
  // inviting/managing people acts on that client.
  const { orgId } = await resolveActiveOrg(db, user!.id);
  const { data: org } = orgId ? await db.from("organizations").select("*").eq("id", orgId).single() : { data: null as any };

  // Members = users whose home org is this client, plus anyone granted access
  // via org_members (shown as "shared access").
  let members: any[] = [];
  if (orgId) {
    const [{ data: homeUsers }, { data: shares }] = await Promise.all([
      db.from("users").select("id, full_name, email, is_active, is_platform_owner").eq("org_id", orgId),
      db.from("org_members").select("user_id").eq("org_id", orgId),
    ]);
    const homeIds = new Set((homeUsers || []).map((u: any) => u.id));
    members = (homeUsers || []).map((u: any) => ({ ...u, via: "home" }));
    const sharedIds = (shares || []).map((s: any) => s.user_id).filter((id: string) => !homeIds.has(id));
    if (sharedIds.length) {
      const { data: sharedUsers } = await db.from("users").select("id, full_name, email, is_active, is_platform_owner").in("id", sharedIds);
      for (const u of sharedUsers || []) members.push({ ...(u as any), via: "shared" });
    }
  }

  return (
    <>
      <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center flex-shrink-0">
        <h1 className="text-base font-semibold text-[#0f172a]">Settings</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Profile */}
          <div className="bg-white rounded-xl border border-[#e2e8f0] p-6">
            <h3 className="text-sm font-semibold text-[#334155] mb-4">Profile</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#64748b]">Name</span>
                <span className="text-sm font-medium text-[#0f172a]">{profile?.full_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#64748b]">Email</span>
                <span className="text-sm text-[#334155]">{profile?.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#64748b]">Role</span>
                <Badge>{profile?.role}</Badge>
              </div>
            </div>
          </div>

          {/* Organization */}
          <div className="bg-white rounded-xl border border-[#e2e8f0] p-6">
            <h3 className="text-sm font-semibold text-[#334155] mb-4">Organization</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#64748b]">Name</span>
                <span className="text-sm font-medium text-[#0f172a]">{org?.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#64748b]">Slug</span>
                <span className="text-sm text-[#334155] font-mono">{org?.slug}</span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-[#eef1f5]">
                <span className="text-sm text-[#64748b]">Facility type</span>
                <span className="text-sm font-medium text-[#0f172a]">Short-Term Acute Care</span>
              </div>
            </div>
          </div>

          {/* Team */}
          <TeamManager members={members} />
        </div>
      </div>
    </>
  );
}
