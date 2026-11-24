import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/active-org";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { isAuditLocked } from "@/lib/audit-lock";
import { makeScrubber } from "@/lib/phi-guard";

export const maxDuration = 60;
const num = (v: any) => { if (v == null || v === "") return null; const n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? null : n; };
const str = (v: any) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };

export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sessionClient = await createSessionClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { orgId } = await resolveActiveOrg(db, user.id);

    const { auditId, rows, replace = true } = await request.json();
    if (auditId && await isAuditLocked(db, auditId)) return NextResponse.json({ error: "This quarter is completed (locked)." }, { status: 409 });
    if (!auditId || !Array.isArray(rows)) return NextResponse.json({ error: "Missing auditId or rows" }, { status: 400 });

    // Only the analytic fields below are stored (anything else in the payload is
    // dropped), and reference fields are re-scrubbed server-side in case a client
    // other than the Converge uploader posts identifier-like values.
    const scrubber = makeScrubber("REF");
    const records = rows.map((r: any) => ({
      audit_id: auditId, org_id: orgId,
      claim_id: scrubber.scrub(str(r.claim_id)), line_control: scrubber.scrub(str(r.line_control)), service_date: str(r.service_date), hcpcs: str(r.hcpcs),
      mod1: str(r.mod1), mod2: str(r.mod2), mod3: str(r.mod3), mod4: str(r.mod4),
      rev_code: str(r.rev_code), units: num(r.units), dx_code: str(r.dx_code), place_of_service: str(r.place_of_service),
      billed_amount: num(r.billed_amount), allowed_amount: num(r.allowed_amount), paid_amount: num(r.paid_amount),
      contractual_adj: num(r.contractual_adj), patient_resp: num(r.patient_resp),
      denial_code: str(r.denial_code), rarc_code: str(r.rarc_code), cas_group: str(r.cas_group), payer: str(r.payer),
    })).filter((r: any) => r.hcpcs || r.claim_id);

    if (records.length === 0) return NextResponse.json({ error: "No usable claim rows (need a HCPCS or claim id)" }, { status: 400 });
    if (replace) await db.from("claims_extract").delete().eq("audit_id", auditId);

    let inserted = 0;
    for (let i = 0; i < records.length; i += 1000) {
      const { error } = await db.from("claims_extract").insert(records.slice(i, i + 1000));
      if (error) return NextResponse.json({ error: error.message, insertedSoFar: inserted }, { status: 500 });
      inserted += Math.min(1000, records.length - i);
    }
    return NextResponse.json({ success: true, inserted });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
