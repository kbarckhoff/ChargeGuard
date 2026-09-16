import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { notFound } from "next/navigation";
import { AdminClientDetail } from "@/components/admin/AdminClientDetail";

export default async function AdminClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: org } = await db.from("organizations").select("id, name, contact_email, created_at").eq("id", id).maybeSingle();
  if (!org) notFound();

  const { orgId: activeOrgId } = await resolveActiveOrg(db, user!.id);

  const [{ data: members }, { data: depts }] = await Promise.all([
    db.from("users").select("id, full_name, email, role, is_active").eq("org_id", id).order("email"),
    db.from("departments").select("id, name").eq("org_id", id).eq("is_active", true).order("name"),
  ]);

  return (
    <div className="flex-1 overflow-auto">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <AdminClientDetail
          org={{ id: org.id, name: org.name, contact_email: org.contact_email || "" }}
          members={(members || []).map((m: any) => ({ id: m.id, name: m.full_name || "", email: m.email, role: m.role || "", active: m.is_active !== false }))}
          departments={(depts || []).map((d: any) => ({ id: d.id, name: d.name }))}
          isActive={activeOrgId === org.id}
        />
      </div>
    </div>
  );
}
