import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AssessmentLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#f4f6f8]">
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">{children}</main>
    </div>
  );
}
