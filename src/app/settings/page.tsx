import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { Badge } from "@/components/ui/shared";
import { FacilityTypeSetting } from "@/components/settings/FacilityTypeSetting";
import { TeamManager } from "@/components/settings/TeamManager";
import type { FacilityType } from "@/lib/rule-catalog";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("users").select("*, organizations(*)").eq("id", user!.id).single();
  const org = profile?.organizations as any;
  const facilityType: FacilityType = (org?.settings?.facility_type as FacilityType) || "opps_outpatient";

  // Team data (service-role read, scoped to this org).
  const orgId = profile?.org_id as string | undefined;
  let members: any[] = [], departments: any[] = [], invites: any[] = [];
  if (orgId) {
    const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const [{ data: deps }, { data: us }, { data: uds }, { data: invs }] = await Promise.all([
      db.from("departments").select("id, name").eq("org_id", orgId).eq("is_active", true).order("sort_order"),
      db.from("users").select("id, full_name, email, is_active, is_platform_owner").eq("org_id", orgId),
      db.from("user_departments").select("user_id, department_id").eq("org_id", orgId),
      db.from("invitations").select("id, email, department_ids").eq("org_id", orgId).eq("status", "pending"),
    ]);
    departments = deps || [];
    const byUser: Record<string, string[]> = {};
    for (const ud of uds || []) (byUser[(ud as any).user_id] ||= []).push((ud as any).department_id);
    members = (us || []).map((u: any) => ({ ...u, department_ids: byUser[u.id] || [] }));
    invites = invs || [];
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
                <span className="text-sm font-medium text-[#0f172a]">{(profile?.organizations as any)?.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#64748b]">Slug</span>
                <span className="text-sm text-[#334155] font-mono">{org?.slug}</span>
              </div>
              <div className="pt-3 border-t border-[#eef1f5]">
                <FacilityTypeSetting initial={facilityType} />
              </div>
            </div>
          </div>

          {/* Team */}
          <TeamManager members={members} departments={departments} invites={invites} />
        </div>
      </div>
    </>
  );
}
