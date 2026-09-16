import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";

// Admin area is platform-owner only (the firm managing all hospital clients).
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: me } = await db.from("users").select("is_platform_owner").eq("id", user.id).single();
  if (!me?.is_platform_owner) redirect("/runs");

  return (
    <div className="flex h-screen bg-[#f4f6f8] overflow-hidden">
      <AppSidebar />
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">{children}</main>
    </div>
  );
}
