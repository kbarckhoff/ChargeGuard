import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClientLib } from "@supabase/supabase-js";
import { resolveActiveOrg } from "@/lib/active-org";
import { buildDepartmentRollup, type RollupFinding, type GlRow } from "@/lib/department-rollup";

// Department rollup: which departments are the "problem children." Findings are
// assigned to a department by matching their CDM charge code against the GL/
// department file's charge-code prefixes (Greg's method).
const money = (n: number) => {
  const v = Math.round(n);
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toLocaleString()}`;
};

export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<{ auditId?: string }> }) {
  const { auditId: wantedId } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const db = createAdminClientLib(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { orgId } = await resolveActiveOrg(db, user!.id);

  // Resolve the review (explicit ?auditId, else most recent).
  let audit: any = null;
  if (wantedId) { const { data } = await db.from("audits").select("id, hospital_name").eq("org_id", orgId).eq("id", wantedId).maybeSingle(); audit = data; }
  if (!audit) { const { data } = await db.from("audits").select("id, hospital_name").eq("org_id", orgId).order("created_at", { ascending: false }).limit(1); audit = data?.[0]; }

  const header = (
    <header className="h-14 border-b border-[#e2e8f0] bg-white px-6 flex items-center justify-between flex-shrink-0">
      <h1 className="text-base font-semibold text-[#0f172a]">Departments</h1>
      {audit && <a href={`/api/findings/department-rollup?auditId=${audit.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[#0a6cff] px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-[#0858d6]">Export</a>}
    </header>
  );
  if (!audit) return <>{header}<div className="flex-1 overflow-y-auto p-6"><div className="max-w-5xl mx-auto text-[13px] text-[#64748b]">No review yet.</div></div></>;

  // Load GL/department file + findings for this review.
  const { data: gl } = await db.from("gl_departments").select("gl_number, department_name, charge_prefix").eq("audit_id", audit.id);
  const findings: RollupFinding[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from("findings").select("category, financial_impact, charge_items(procedure_number)").eq("audit_id", audit.id).eq("org_id", orgId).eq("ehr_lagging", false).range(off, off + 999);
    if (error || !data || data.length === 0) break;
    for (const f of data as any[]) findings.push({ charge_code: f.charge_items?.procedure_number ?? null, category: f.category, financial_impact: f.financial_impact });
    if (data.length < 1000) break;
  }

  const hasGl = (gl || []).length > 0;
  const rollup = buildDepartmentRollup(findings, (gl || []) as GlRow[]);
  const maxImpact = Math.max(rollup.departments[0]?.impact || 0, rollup.unassigned.impact, 1);
  const rows = [...rollup.departments, ...(rollup.unassigned.findings ? [rollup.unassigned] : [])];

  return (
    <>
      {header}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">
          {!hasGl && (
            <div className="mb-4 rounded-lg border border-[#fde68a] bg-[#fffbeb] px-4 py-3 text-[12.5px] text-[#92400e]">
              No GL / department file imported for this review, so everything shows as Unassigned. Import the GL / Department List on the Imports step to roll findings up by department.
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <Stat k="Departments with findings" v={rollup.departments.length.toLocaleString()} />
            <Stat k="Total findings" v={rollup.totalFindings.toLocaleString()} />
            <Stat k="Total estimated impact" v={money(rollup.totalImpact)} accent="#15803d" />
          </div>

          <div className="rounded-xl border border-[#e5e7eb] overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="bg-[#f7f8fa] text-left text-[11px] uppercase tracking-wide text-[#64748b]">
                  <th className="px-4 py-2.5 font-semibold">Department</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Findings</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Est. impact</th>
                  <th className="px-4 py-2.5 font-semibold">Top issue categories</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.department} className="border-t border-[#eef1f5] align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-[#0f172a]">{d.department}</div>
                      {d.gl_number && <div className="text-[11px] text-[#94a3b8]">GL {d.gl_number}</div>}
                      <div className="mt-1.5 h-1.5 w-full max-w-[160px] rounded-full bg-[#eef2f6] overflow-hidden">
                        <span className="block h-full rounded-full bg-[#0a6cff]" style={{ width: `${Math.max(2, (d.impact / maxImpact) * 100)}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{d.findings.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-[#15803d]">{money(d.impact)}</td>
                    <td className="px-4 py-3 text-[12.5px] text-[#475569]">
                      {d.topCategories.length ? d.topCategories.map((c, i) => (
                        <span key={c.category}>{i > 0 && <span className="text-[#cbd5e1]"> · </span>}{c.category} <span className="text-[#94a3b8]">({c.count})</span></span>
                      )) : <span className="text-[#94a3b8]">—</span>}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-[#94a3b8]">No findings in this review.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[#94a3b8] mt-3">{audit.hospital_name || "Facility"} · findings routed to departments by charge-code prefix from the GL / department file.</p>
        </div>
      </div>
    </>
  );
}

function Stat({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-[#e5e7eb] bg-white p-4">
      <div className="text-[11.5px] font-medium text-[#64748b]">{k}</div>
      <div className="text-[22px] font-semibold mt-1 tabular-nums" style={{ color: accent || "#0f172a" }}>{v}</div>
    </div>
  );
}
