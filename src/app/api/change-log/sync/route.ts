import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
const key = (r: any) => (r.procedure_number || r.hcpcs_cpt_code || "").toString().trim();

// Does a freshly-uploaded line already reflect an exported change?
function reflected(change: any, row: any | undefined): boolean {
  if (change.action_type === "deactivate") return !row || row.is_active === false;
  if (!row) return false;
  const v = change.new_value;
  if (v == null || v === "") return false;
  switch (change.field) {
    case "price": { const a = Number(String(row.gross_charge)); const b = Number(String(v).replace(/[$,]/g, "")); return isFinite(a) && isFinite(b) && Math.abs(a - b) < 0.01; }
    case "description": return (row.charge_description || "").trim() === String(v).trim();
    case "revenue_code": return (row.revenue_code || "").toString().trim() === String(v).trim();
    case "modifier": return (row.modifier_1 || "").toString().trim() === String(v).trim();
    case "hcpcs": return (row.hcpcs_cpt_code || "").toString().trim() === String(v).trim();
    default: return false;
  }
}

// Smart-sync a new CDM upload against the org's approved changes.
//  action "reconcile": mark exported changes that the new upload now reflects as
//                      "implemented"; report those still missing.
//  action "reapply":   re-stage the still-missing exported changes as pending on
//                      this run so they can be re-exported.
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { auditId, action } = await request.json();
    if (!auditId) return NextResponse.json({ error: "Missing auditId" }, { status: 400 });

    const db = admin();
    const { data: audit } = await db.from("audits").select("org_id").eq("id", auditId).single();
    if (!audit) return NextResponse.json({ error: "Review not found" }, { status: 404 });

    // Latest uploaded lines for this run.
    const rows: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data } = await db.from("charge_items").select("procedure_number, hcpcs_cpt_code, charge_description, revenue_code, modifier_1, gross_charge, is_active").eq("audit_id", auditId).range(off, off + 999);
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    const byKey: Record<string, any> = {};
    for (const r of rows) byKey[key(r)] = r;

    // "Awaiting EHR sync" = exported or previously flagged approved-but-missing.
    const { data: changes } = await db.from("cdm_change_log").select("*").eq("org_id", audit.org_id).in("status", ["exported", "approved_missing"]);
    const list = changes || [];

    const implementedIds: string[] = [];
    const missing: any[] = [];
    for (const c of list as any[]) {
      if (reflected(c, byKey[c.line_key])) implementedIds.push(c.id);   // Case A: EHR now has it -> Closed & Synced
      else missing.push(c);                                             // Case B: EHR still lagging
    }

    if (action === "reconcile") {
      const now = new Date().toISOString();
      if (implementedIds.length) {
        await db.from("cdm_change_log").update({ status: "implemented", implemented_at: now, updated_at: now }).in("id", implementedIds);
      }
      // Flag still-missing exported entries as "approved but missing from EHR".
      const toFlag = missing.filter((m) => m.status === "exported").map((m) => m.id);
      if (toFlag.length) {
        await db.from("cdm_change_log").update({ status: "approved_missing", updated_at: now }).in("id", toFlag);
      }
      return NextResponse.json({ ok: true, implemented: implementedIds.length, missing: missing.length });
    }

    if (action === "reapply") {
      if (missing.length) {
        await db.from("cdm_change_log").update({ status: "pending", audit_id: auditId, updated_at: new Date().toISOString() }).in("id", missing.map((m) => m.id));
      }
      return NextResponse.json({ ok: true, reapplied: missing.length });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
