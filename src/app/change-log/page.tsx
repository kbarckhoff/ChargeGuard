import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { ChangeLogClient } from "@/components/changelog/ChangeLogClient";

// The CDM change log: the source of truth for accepted changes across every
// review. Accepting a finding stages a pending entry here; "Generate Updated
// CDM" overlays them on the baseline and exports the file.
export default async function ChangeLogPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { orgId: __org } = await resolveActiveOrg(db, user!.id);
  const orgId = (__org ?? undefined) as string | undefined;

  let entries: any[] = [], reviews: { id: string; name: string }[] = [], latestAuditId: string | null = null;
  if (orgId) {
    const [{ data: rows }, { data: audits }, { data: users }] = await Promise.all([
      db.from("cdm_change_log").select("*").eq("org_id", orgId).order("change_number", { ascending: false }),
      db.from("audits").select("id, name, created_at").eq("org_id", orgId).order("created_at", { ascending: false }),
      db.from("users").select("id, full_name").eq("org_id", orgId),
    ]);
    const nameById: Record<string, string> = {};
    for (const u of users || []) nameById[(u as any).id] = (u as any).full_name;
    entries = (rows || []).map((e: any) => ({ ...e, approver_name: e.approver ? nameById[e.approver] || null : null }));
    reviews = (audits || []).map((a: any) => ({ id: a.id, name: a.name || "Untitled review" }));
    latestAuditId = reviews[0]?.id || null;
  }

  const pending = entries.filter((e) => e.status === "pending").length;
  const exported = entries.filter((e) => e.status === "exported").length;

  return (
    <>
      <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold text-[#0f172a]">Change Log</h1>
        <span className="text-sm text-[#94a3b8]">{pending} pending · {exported} awaiting EHR implementation</span>
      </header>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto">
          <ChangeLogClient entries={entries} reviews={reviews} latestAuditId={latestAuditId} />
        </div>
      </div>
    </>
  );
}
