import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { QueueClient } from "@/components/queue/QueueClient";

// My Work Queue: the findings assigned to the signed-in user for action.
export default async function QueuePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { orgId } = await resolveActiveOrg(db, user!.id);

  let rows: any[] = [];
  if (orgId) {
    const { data } = await db
      .from("findings")
      .select("id, title, description, category, severity, status, financial_impact, recommendation, resolution_note, charge_items(procedure_number, hcpcs_cpt_code, charge_description, gross_charge)")
      .eq("org_id", orgId)
      .eq("assigned_to", user!.id)
      // Active work only: things still needing action. Once a finding is marked
      // implemented (resolved) or denied/N-A, it drops off the queue.
      .in("status", ["open", "in_review", "accepted"])
      .order("status", { ascending: true })
      .order("severity", { ascending: true })
      .limit(300);
    rows = data || [];
  }
  const open = rows.filter((r) => r.status === "open" || r.status === "in_review").length;
  const toWork = rows.filter((r) => r.status === "accepted").length;

  return (
    <>
      <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#0f172a]">My Work Queue</h1>
        <span className="text-sm text-[#94a3b8]">{open} to review · {toWork} to implement</span>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          <QueueClient rows={rows} />
        </div>
      </div>
    </>
  );
}
