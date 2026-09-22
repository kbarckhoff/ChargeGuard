import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { applyDisposition, VALID_STATUSES } from "@/lib/disposition";

// Disposition every line in a to-do group at once. grp_key (from findings_todos):
//   'C:<category>|<code>' — all findings of that category on that HCPCS code
//   'L:<finding uuid>'    — a single finding with no code to group on
export async function POST(request: Request) {
  try {
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { auditId, grpKey, status, note } = await request.json();
    if (!auditId || !grpKey || !status) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    if (!VALID_STATUSES.includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });

    // Resolve the member finding ids for this group.
    let ids: string[] = [];
    if (grpKey.startsWith("L:")) {
      ids = [grpKey.slice(2)];
    } else if (grpKey.startsWith("C:")) {
      const rest = grpKey.slice(2);
      const idx = rest.lastIndexOf("|");
      const category = rest.slice(0, idx);
      const code = rest.slice(idx + 1);
      // Charge lines in this review that use the code, then this category's findings on them.
      const itemIds: string[] = [];
      for (let off = 0; ; off += 1000) {
        const { data } = await admin.from("charge_items").select("id").eq("audit_id", auditId).eq("hcpcs_cpt_code", code).range(off, off + 999);
        if (!data || data.length === 0) break;
        itemIds.push(...data.map((r: any) => r.id));
        if (data.length < 1000) break;
      }
      if (itemIds.length) {
        const { data: fnds } = await admin
          .from("findings").select("id")
          .eq("audit_id", auditId).eq("category", category).eq("ehr_lagging", false)
          .in("charge_item_id", itemIds);
        ids = (fnds || []).map((r: any) => r.id);
      }
    }
    if (ids.length === 0) return NextResponse.json({ error: "No matching findings" }, { status: 404 });

    let updated = 0;
    for (const id of ids) {
      const { error } = await applyDisposition(admin, user.id, { findingId: id, status, note });
      if (!error) updated++;
    }
    return NextResponse.json({ success: true, updated });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
