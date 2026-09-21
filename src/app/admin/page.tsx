import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { AdminClients } from "@/components/admin/AdminClients";
import { AdminTabs } from "@/components/admin/AdminTabs";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { orgId: activeOrgId } = await resolveActiveOrg(db, user!.id);
  const { data: orgs } = await db
    .from("organizations")
    .select("id, name, created_at")
    .order("created_at", { ascending: false });

  // Member count per org (for the list).
  const { data: members } = await db.from("users").select("org_id");
  const counts: Record<string, number> = {};
  (members || []).forEach((m: any) => { if (m.org_id) counts[m.org_id] = (counts[m.org_id] || 0) + 1; });

  const rows = (orgs || []).map((o: any) => ({ id: o.id, name: o.name, members: counts[o.id] || 0 }));

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <h1 className="text-xl font-semibold text-[#0f172a] mb-4">Admin</h1>
        <AdminTabs />
        <p className="text-sm text-[#64748b] mb-6">Create a hospital client, assign its administrator, and switch which hospital you're working in.</p>
        <AdminClients rows={rows} activeOrgId={activeOrgId} />
      </div>
    </div>
  );
}
