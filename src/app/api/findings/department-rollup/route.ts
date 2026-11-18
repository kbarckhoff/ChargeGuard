import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { resolveActiveOrg } from "@/lib/active-org";
import { buildDepartmentRollup, type RollupFinding, type GlRow } from "@/lib/department-rollup";
import * as XLSX from "xlsx-js-style";

export const maxDuration = 60;
const MONEY = '"$"#,##0';
const HEADFILL = { fill: { patternType: "solid", fgColor: { rgb: "0A6CFF" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { vertical: "center", wrapText: true } };

export async function GET(request: Request) {
  const sc = await createSessionClient();
  const { data: { user } } = await sc.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const { orgId } = await resolveActiveOrg(db, user.id);

  const auditId = new URL(request.url).searchParams.get("auditId");
  if (!auditId) return NextResponse.json({ error: "auditId is required" }, { status: 400 });
  const { data: audit } = await db.from("audits").select("hospital_name").eq("id", auditId).eq("org_id", orgId).maybeSingle();

  const { data: gl } = await db.from("gl_departments").select("gl_number, department_name, charge_prefix").eq("audit_id", auditId);
  const findings: RollupFinding[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from("findings").select("category, financial_impact, charge_items(procedure_number)").eq("audit_id", auditId).eq("org_id", orgId).eq("ehr_lagging", false).range(off, off + 999);
    if (error || !data || data.length === 0) break;
    for (const f of data as any[]) findings.push({ charge_code: f.charge_items?.procedure_number ?? null, category: f.category, financial_impact: f.financial_impact });
    if (data.length < 1000) break;
  }

  const rollup = buildDepartmentRollup(findings, (gl || []) as GlRow[]);
  const rows = [...rollup.departments, ...(rollup.unassigned.findings ? [rollup.unassigned] : [])];

  // Summary sheet
  const sumAoa: any[][] = [["Department", "GL", "Findings", "Est. Impact", "Top issue categories"]];
  for (const d of rows) sumAoa.push([d.department, d.gl_number ?? "", d.findings, d.impact, d.topCategories.map((c) => `${c.category} (${c.count})`).join("; ")]);
  const sum = XLSX.utils.aoa_to_sheet(sumAoa);
  sum["!cols"] = [{ wch: 30 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 60 }];
  for (let c = 0; c < 5; c++) { const a = XLSX.utils.encode_cell({ r: 0, c }); if (sum[a]) sum[a].s = HEADFILL; }
  for (let r = 1; r < sumAoa.length; r++) { const a = XLSX.utils.encode_cell({ r, c: 3 }); if (sum[a]) { sum[a].t = "n"; sum[a].z = MONEY; sum[a].s = { numFmt: MONEY }; } }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sum, "By Department");

  const safe = String(audit?.hospital_name || "facility").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="department-rollup-${safe}.xlsx"`,
    },
  });
}
