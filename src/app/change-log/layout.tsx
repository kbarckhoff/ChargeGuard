import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";

export default async function ChangeLogLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  return (
    <div className="flex h-screen bg-[#f4f6f8] overflow-hidden">
      <AppSidebar />
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">{children}</main>
    </div>
  );
}
