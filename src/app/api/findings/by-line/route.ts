import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// All findings on one CDM line (for the "By CDM line" expand view).
export async function GET(request: Request) {
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const lineId = searchParams.get("lineId");
    if (!lineId) return NextResponse.json({ error: "Missing lineId" }, { status: 400 });
    // Scope to the categories shown in the current tab/view (so, e.g., the CDM
    // tab's expand doesn't surface a line's RVU or informational findings).
    const cats = (searchParams.get("cats") || "").split("|").map((c) => c.trim()).filter(Boolean);

    let q = admin
      .from("findings")
      .select("*, charge_items(procedure_number, charge_description, hcpcs_cpt_code, revenue_code, gross_charge)")
      .eq("charge_item_id", lineId)
      .eq("ehr_lagging", false)
      .order("severity", { ascending: true });
    if (cats.length) q = q.in("category", cats);
    const { data } = await q;
    return NextResponse.json({ lines: data || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
