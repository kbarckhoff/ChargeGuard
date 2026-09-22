import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// By-CDM-line rows for the record view: CDM lines that have an in-scope finding,
// one row per line, with issue count, worst severity, categories, and impact.
// Lazy-loaded by the Findings workspace so the grouped view stays instant.
const SEV_RANK: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
const rankToSev = (r: number) => (r >= 5 ? "critical" : r >= 4 ? "high" : r >= 3 ? "medium" : r >= 2 ? "low" : r >= 1 ? "info" : null);

export async function GET(request: Request) {
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const auditId = searchParams.get("auditId");
    if (!auditId) return NextResponse.json({ error: "Missing auditId" }, { status: 400 });
    const cats = (searchParams.get("cats") || "").split("|").map((c) => c.trim()).filter(Boolean);
    const q = (searchParams.get("q") || "").trim().toLowerCase();
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = 50;

    const rows: any[] = [];
    for (let off = 0; ; off += 1000) {
      let fq = admin
        .from("findings")
        .select("charge_item_id, severity, category, financial_impact, charge_items(source_row, procedure_number, hcpcs_cpt_code, charge_description)")
        .eq("audit_id", auditId).eq("ehr_lagging", false)
        .order("id", { ascending: true }).range(off, off + 999);
      if (cats.length) fq = fq.in("category", cats);
      const { data, error } = await fq;
      if (error || !data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }

    const map = new Map<string, any>();
    for (const r of rows) {
      const id = r.charge_item_id; if (!id) continue;
      const ci = r.charge_items || {};
      const e = map.get(id) || { id, record_no: ci.source_row ?? null, procedure_number: ci.procedure_number ?? null, hcpcs_cpt_code: ci.hcpcs_cpt_code ?? null, charge_description: ci.charge_description ?? null, issue_count: 0, impact: 0, sev: 0, cats: new Set<string>() };
      e.issue_count += 1; e.impact += r.financial_impact || 0; e.sev = Math.max(e.sev, SEV_RANK[r.severity] || 0); if (r.category) e.cats.add(r.category);
      map.set(id, e);
    }
    let arr = [...map.values()];
    if (q) arr = arr.filter((l) => (l.procedure_number || "").toLowerCase().includes(q) || (l.hcpcs_cpt_code || "").toLowerCase().includes(q) || (l.charge_description || "").toLowerCase().includes(q) || String(l.record_no ?? "").includes(q));
    arr.sort((a, b) => ((a.record_no ?? 1e12) - (b.record_no ?? 1e12)) || String(a.procedure_number || "").localeCompare(String(b.procedure_number || "")));
    const total = arr.length;
    const lines = arr.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize).map((l) => ({
      id: l.id, record_no: l.record_no, procedure_number: l.procedure_number, hcpcs_cpt_code: l.hcpcs_cpt_code,
      charge_description: l.charge_description, issue_count: l.issue_count, worst_sev: rankToSev(l.sev), categories: [...l.cats], impact: l.impact,
    }));
    return NextResponse.json({ lines, total, page, pageSize });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
