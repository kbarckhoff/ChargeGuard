import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/shared";

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = await supabase.from("users").select("*, organizations(*)").eq("id", user!.id).single();

  return (
    <>
      <header className="h-14 border-b border-[#e5e5e0] bg-white px-6 flex items-center flex-shrink-0">
        <h1 className="text-base font-semibold text-[#1a1a18]">Settings</h1>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Profile */}
          <div className="bg-white rounded-xl border border-[#e5e5e0] p-6">
            <h3 className="text-sm font-semibold text-[#3d3d3a] mb-4">Profile</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#7a7a75]">Name</span>
                <span className="text-sm font-medium text-[#1a1a18]">{profile?.full_name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#7a7a75]">Email</span>
                <span className="text-sm text-[#3d3d3a]">{profile?.email}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#7a7a75]">Role</span>
                <Badge>{profile?.role}</Badge>
              </div>
            </div>
          </div>

          {/* Organization */}
          <div className="bg-white rounded-xl border border-[#e5e5e0] p-6">
            <h3 className="text-sm font-semibold text-[#3d3d3a] mb-4">Organization</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#7a7a75]">Name</span>
                <span className="text-sm font-medium text-[#1a1a18]">{(profile?.organizations as any)?.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#7a7a75]">Slug</span>
                <span className="text-sm text-[#3d3d3a] font-mono">{(profile?.organizations as any)?.slug}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
