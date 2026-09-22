import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Paginated per-finding list for the "Show all lines" view. Lazy-loaded by the
// Findings workspace so the default grouped view stays instant.
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
    const severity = searchParams.get("severity") || "all";
    const status = searchParams.get("status") || "all";
    const tier = searchParams.get("tier") || "all";
    const assignee = searchParams.get("assignee") || "all";
    const search = searchParams.get("q") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = 50;
    const from = (page - 1) * pageSize;

    let query = admin
      .from("findings")
      .select("*, charge_items(procedure_number, charge_description, hcpcs_cpt_code, revenue_code, gross_charge)", { count: "exact" })
      .eq("audit_id", auditId).eq("ehr_lagging", false)
      .order("severity", { ascending: true }).order("created_at", { ascending: false });
    if (cats.length) query = query.in("category", cats);
    if (severity !== "all") query = query.eq("severity", severity);
    if (status !== "all") query = query.eq("status", status);
    if (tier !== "all") { if (tier === "1") query = query.or("tier.eq.1,tier.is.null"); else query = query.eq("tier", Number(tier)); }
    if (search) query = query.ilike("title", `%${search}%`);
    if (assignee !== "all") { if (assignee === "none") query = query.is("assigned_to", null); else if (assignee === "me") query = query.eq("assigned_to", user.id); else query = query.eq("assigned_to", assignee); }

    const { data, count } = await query.range(from, from + pageSize - 1);
    return NextResponse.json({ findings: data || [], total: count || 0, page, pageSize });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
