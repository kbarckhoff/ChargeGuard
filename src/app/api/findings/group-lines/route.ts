import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Member lines of a to-do group (for the expand view on the Findings page).
export async function GET(request: Request) {
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const auditId = searchParams.get("auditId");
    const grpKey = searchParams.get("grpKey");
    if (!auditId || !grpKey) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    // Full finding rows so the expand can open the same detail drawer as the
    // By-CDM-line view (issue details, recommendation, assignment, disposition).
    const sel = "*, charge_items(procedure_number, hcpcs_cpt_code, revenue_code, charge_description, gross_charge)";
    let rows: any[] = [];
    if (grpKey.startsWith("L:")) {
      const { data } = await admin.from("findings").select(sel).eq("id", grpKey.slice(2));
      rows = data || [];
    } else if (grpKey.startsWith("C:")) {
      const rest = grpKey.slice(2);
      const idx = rest.lastIndexOf("|");
      const category = rest.slice(0, idx);
      const code = rest.slice(idx + 1);
      const { data: items } = await admin.from("charge_items").select("id").eq("audit_id", auditId).eq("hcpcs_cpt_code", code);
      const itemIds = (items || []).map((r: any) => r.id);
      if (itemIds.length) {
        const { data } = await admin.from("findings").select(sel)
          .eq("audit_id", auditId).eq("category", category).eq("ehr_lagging", false)
          .in("charge_item_id", itemIds).order("id", { ascending: true });
        rows = data || [];
      }
    }
    return NextResponse.json({ lines: rows });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
