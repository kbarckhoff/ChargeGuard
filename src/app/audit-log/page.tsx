import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { getActor } from "@/lib/roles";
import { redirect } from "next/navigation";

const ACTION_LABEL: Record<string, string> = {
  assigned: "Assigned", unassigned: "Unassigned", accepted: "Accepted", rejected: "Denied", na: "Marked N/A", note: "Noted",
};
const ACTION_STYLE: Record<string, string> = {
  assigned: "text-[#1e293b] bg-[#eef2ff]", unassigned: "text-[#94a3b8] bg-[#f1f5f9]",
  accepted: "text-[#067647] bg-[#e7f7ef]", rejected: "text-[#b42318] bg-[#fdeceb]",
  na: "text-[#475569] bg-[#f1f5f9]", note: "text-[#8a5a1a] bg-[#fef4e6]",
};

function when(ts: string): string {
  try { return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return ts; }
}

// Audit Log: every assignment and disposition action for the active client, with
// who did it, when, and the note / action taken. Analyst + Super User only.
export default async function AuditLogPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const actor = await getActor(db, user!.id);
  if (!actor.canAssign) redirect("/runs");

  const { orgId } = await resolveActiveOrg(db, user!.id);
  let entries: any[] = [];
  const nameById: Record<string, string> = {};
  const findingById: Record<string, string> = {};
  if (orgId) {
    const { data: acts } = await db
      .from("finding_activity")
      .select("id, action, actor_id, assignee_id, finding_id, note, action_taken, effective_date, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(300);
    entries = acts || [];
    const userIds = new Set<string>();
    const findingIds = new Set<string>();
    for (const e of entries) { if (e.actor_id) userIds.add(e.actor_id); if (e.assignee_id) userIds.add(e.assignee_id); if (e.finding_id) findingIds.add(e.finding_id); }
    if (userIds.size) {
      const { data: us } = await db.from("users").select("id, full_name, email").in("id", [...userIds]);
      for (const u of us || []) nameById[(u as any).id] = (u as any).full_name || (u as any).email;
    }
    if (findingIds.size) {
      const { data: fs } = await db.from("findings").select("id, title").in("id", [...findingIds]);
      for (const f of fs || []) findingById[(f as any).id] = (f as any).title;
    }
  }

  return (
    <>
      <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#0f172a]">Audit Log</h1>
        <span className="text-sm text-[#94a3b8]">{entries.length} recent {entries.length === 1 ? "event" : "events"}</span>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white rounded-xl border border-[#e2e8f0] overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[#94a3b8] border-b border-[#e2e8f0]">
                  <th className="px-4 py-2.5">When</th><th className="px-4 py-2.5">Who</th><th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Finding</th><th className="px-4 py-2.5">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-[#94a3b8]">No activity yet. Assignments and dispositions will appear here.</td></tr>}
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-[#f1f5f9] align-top">
                    <td className="px-4 py-2.5 whitespace-nowrap text-[#64748b]">{when(e.created_at)}</td>
                    <td className="px-4 py-2.5 text-[#334155]">{nameById[e.actor_id] || "—"}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${ACTION_STYLE[e.action] || "bg-[#f1f5f9] text-[#475569]"}`}>{ACTION_LABEL[e.action] || e.action}</span>
                      {e.assignee_id && <span className="text-[12px] text-[#64748b]"> → {nameById[e.assignee_id] || "user"}</span>}
                    </td>
                    <td className="px-4 py-2.5 max-w-[220px]"><div className="text-[#334155] line-clamp-2">{findingById[e.finding_id] || "—"}</div></td>
                    <td className="px-4 py-2.5 max-w-[260px] text-[#475569]">
                      {e.note && <div className="line-clamp-2">{e.note}</div>}
                      {e.action_taken && <div className="text-[12px] text-[#64748b] mt-0.5">Action: {e.action_taken}</div>}
                      {e.effective_date && <div className="text-[12px] text-[#94a3b8] mt-0.5">Effective {e.effective_date}</div>}
                      {!e.note && !e.action_taken && !e.effective_date && "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
