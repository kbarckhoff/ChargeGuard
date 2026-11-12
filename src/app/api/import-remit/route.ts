import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/active-org";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { isAuditLocked } from "@/lib/audit-lock";

export const maxDuration = 60;

const num = (v: any) => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? null : n; };
const str = (v: any) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };

// Ingest a parsed 835 remittance (claims + lines, parsed client-side by
// remit-parser) into remit_claims / remit_lines for the active review.
export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sessionClient = await createSessionClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { orgId } = await resolveActiveOrg(supabaseAdmin, user.id);
    const { auditId, claims, lines, replace = true } = await request.json();
    if (auditId && await isAuditLocked(supabaseAdmin, auditId)) {
      return NextResponse.json({ error: "This quarter is completed (locked)." }, { status: 409 });
    }
    if (!auditId || (!Array.isArray(claims) && !Array.isArray(lines))) {
      return NextResponse.json({ error: "Missing auditId or remittance rows" }, { status: 400 });
    }

    const claimRecords = (claims || []).map((c: any) => ({
      audit_id: auditId, org_id: orgId,
      claim_id: str(c.claim_id), status: str(c.status),
      total_charge: num(c.total_charge), total_paid: num(c.total_paid), patient_resp: num(c.patient_resp),
      payer_control: str(c.payer_control), adjustments: Array.isArray(c.adjustments) ? c.adjustments : [],
    })).filter((c: any) => c.claim_id);

    const lineRecords = (lines || []).map((l: any) => ({
      audit_id: auditId, org_id: orgId,
      claim_id: str(l.claim_id), hcpcs: str(l.hcpcs), mod1: str(l.mod1), rev_code: str(l.rev_code),
      line_charge: num(l.line_charge), line_paid: num(l.line_paid), units: num(l.units),
      adjustments: Array.isArray(l.adjustments) ? l.adjustments : [],
    })).filter((l: any) => l.hcpcs || l.claim_id);

    if (claimRecords.length === 0 && lineRecords.length === 0) {
      return NextResponse.json({ error: "No usable remittance rows" }, { status: 400 });
    }

    if (replace) {
      await supabaseAdmin.from("remit_claims").delete().eq("audit_id", auditId);
      await supabaseAdmin.from("remit_lines").delete().eq("audit_id", auditId);
    }

    const insertAll = async (table: string, recs: any[]) => {
      for (let i = 0; i < recs.length; i += 1000) {
        const { error } = await supabaseAdmin.from(table).insert(recs.slice(i, i + 1000));
        if (error) throw new Error(`${table}: ${error.message}`);
      }
    };
    await insertAll("remit_claims", claimRecords);
    await insertAll("remit_lines", lineRecords);

    return NextResponse.json({ success: true, claims: claimRecords.length, lines: lineRecords.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
