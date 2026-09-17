import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { resolveActiveOrg } from "@/lib/active-org";

const admin = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

// Add a MANUAL change-log entry — a documentation/audit record of a CDM update
// the tool didn't flag (e.g. a newly added service, a locally-decided change).
//
// Documentation-only by design: source = 'manual', status = 'logged'. It does
// NOT touch findings, the rule analysis, or the smart-sync reconcile (which only
// acts on exported/approved_missing TOOL entries). If the CDM actually changed,
// that change surfaces normally on the next CDM upload + scan.
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = admin();
    const { orgId } = await resolveActiveOrg(db, user.id);
    if (!orgId) return NextResponse.json({ error: "No organization" }, { status: 404 });

    const body = await request.json();
    const procedure_number = (body.procedure_number || "").toString().trim() || null;
    const hcpcs = (body.hcpcs || "").toString().trim() || null;
    const description = (body.description || "").toString().trim() || null;
    const action_type = ["add", "modify", "deactivate"].includes(body.action_type) ? body.action_type : "modify";
    const field = (body.field || "").toString().trim() || null;
    const old_value = (body.old_value ?? "").toString().trim() || null;
    const new_value = (body.new_value ?? "").toString().trim() || null;
    const rationale = (body.rationale || "").toString().trim() || null;
    const effective_date = (body.effective_date || "").toString().trim() || null;
    const audit_id = (body.auditId || "").toString().trim() || null;

    // Need at least a line identifier or a description to anchor the entry.
    const line_key = procedure_number || hcpcs || (description ? `manual:${description.slice(0, 60)}` : null);
    if (!line_key) return NextResponse.json({ error: "Enter a charge/procedure number, HCPCS, or a description." }, { status: 400 });
    if (!rationale) return NextResponse.json({ error: "A rationale is required for the audit trail." }, { status: 400 });

    // Per-org display sequence.
    const { data: maxRow } = await db.from("cdm_change_log").select("change_number").eq("org_id", orgId).order("change_number", { ascending: false }).limit(1).maybeSingle();
    const change_number = (((maxRow as any)?.change_number as number) || 0) + 1;

    const { error } = await db.from("cdm_change_log").insert({
      org_id: orgId,
      audit_id,
      change_number,
      line_key,
      procedure_number,
      hcpcs,
      description,
      action_type,
      field,
      old_value,
      new_value,
      rationale,
      effective_date,
      status: "logged",
      source: "manual",
      requested_by: user.id,
      approver: user.id,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
