import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { SetupQuestionnaire } from "@/components/converge/SetupQuestionnaire";
import type { SetupFacts } from "@/lib/setup-questionnaire";

// CONVERGE setup questionnaire page: the facility facts that gate certain rules.
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ auditId?: string }> }) {
  const { auditId: wantedId } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { orgId } = await resolveActiveOrg(db, user!.id);

  let audit: any = null;
  if (wantedId) {
    const { data } = await db.from("audits").select("id, name, metadata").eq("org_id", orgId).eq("id", wantedId).maybeSingle();
    audit = data;
  }
  if (!audit) {
    const { data } = await db.from("audits").select("id, name, metadata").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1);
    audit = data?.[0];
  }

  const header = (
    <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
      <h1 className="text-base font-semibold text-[#0f172a]">Setup</h1>
    </header>
  );
  if (!audit) {
    return <>{header}<div className="flex-1 overflow-y-auto p-6"><div className="max-w-3xl mx-auto text-[13px] text-[#64748b]">Start a review first, then fill in the setup facts here.</div></div></>;
  }

  const initial: SetupFacts = ((audit.metadata as any)?.setup_facts as SetupFacts) || {};

  return (
    <>
      {header}
      <div className="flex-1 overflow-y-auto p-6">
        <SetupQuestionnaire auditId={audit.id} initial={initial} />
      </div>
    </>
  );
}
