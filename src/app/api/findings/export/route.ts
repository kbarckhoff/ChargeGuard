import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { bucketForCategory, BUCKET_LABELS, type FindingBucket } from "@/lib/finding-buckets";
import { classForCategory, CLASS_LABELS } from "@/lib/finding-class";

// Export findings as CSV — one bucket (cdm | rvu | formulary | peer), or the
// entire list when bucket=all.
export async function GET(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: userData } = await db.from("users").select("org_id").eq("id", user.id).single();
    if (!userData) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const auditId = searchParams.get("auditId");
    const bucketParam = searchParams.get("bucket") || "cdm";
    const isAll = bucketParam === "all";
    const bucket = bucketParam as FindingBucket;
    if (!auditId) return NextResponse.json({ error: "auditId is required" }, { status: 400 });

    // Page through all findings for the audit (Supabase caps at 1000/response).
    const rows: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from("findings")
        .select("tier, status, severity, category, title, description, recommendation, financial_impact, resolution_note, charge_items(procedure_number, hcpcs_cpt_code, revenue_code, charge_description, gross_charge)")
        .eq("audit_id", auditId)
        .eq("org_id", userData.org_id)
        .eq("ehr_lagging", false)
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error || !data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }

    const filtered = isAll ? rows : rows.filter((r) => bucketForCategory(r.category) === bucket);

    const STATUS: Record<string, string> = { open: "Open", in_review: "Under Review", accepted: "Accepted", rejected: "Denied", na: "N/A", resolved: "Accepted" };
    const TIER: Record<number, string> = { 1: "1 - New", 2: "2 - Accepted before", 3: "3 - Denied before", 4: "4 - N/A before" };
    const esc = (v: any) => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ["Work type", "Tier", "Status", "Severity", "Category", "Finding", "Charge Code", "HCPCS/CPT", "Rev Code", "Description", "Price", "Est. Impact", "Detail", "Recommendation", "Reviewer Note"];
    const lines = [header.join(",")];
    for (const r of filtered) {
      const ci = r.charge_items || {};
      lines.push([
        CLASS_LABELS[classForCategory(r.category)],
        TIER[r.tier] || (r.tier ?? ""),
        STATUS[r.status] || r.status,
        r.severity,
        r.category,
        r.title,
        ci.procedure_number,
        ci.hcpcs_cpt_code,
        ci.revenue_code,
        ci.charge_description,
        ci.gross_charge,
        r.financial_impact,
        r.description,
        r.recommendation,
        r.resolution_note,
      ].map(esc).join(","));
    }
    const csv = lines.join("\n") + "\n";
    const fname = isAll ? "all-findings.csv" : `${BUCKET_LABELS[bucket].replace(/\s+/g, "-").toLowerCase()}.csv`;
    return new NextResponse(csv, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fname}"` },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
