import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const sessionClient = await createSessionClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { findingId, status, note } = await request.json();

    if (!findingId || !status) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    const validStatuses = ["open", "in_review", "accepted", "rejected", "resolved"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const updates: Record<string, unknown> = { status };
    if (typeof note === "string") updates.resolution_note = note;
    if (status === "resolved") {
      updates.resolved_at = new Date().toISOString();
      updates.resolved_by = user.id;
    } else if (status === "open") {
      updates.resolved_at = null;
      updates.resolved_by = null;
    }

    const { error } = await supabaseAdmin
      .from("findings")
      .update(updates)
      .eq("id", findingId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Carry-forward ledger: a rejection (with reason) becomes a persistent
    // exception keyed to the CDM line + category, so the next run can auto-carry
    // it. Reopening/accepting clears the exception.
    try {
      const { data: f } = await supabaseAdmin
        .from("findings")
        .select("org_id, audit_id, category, financial_impact, charge_items(procedure_number, hcpcs_cpt_code, gross_charge)")
        .eq("id", findingId)
        .single();
      const ci: any = (f as any)?.charge_items || {};
      const lineKey: string = (ci.procedure_number || ci.hcpcs_cpt_code || "").toString().trim();
      const category: string = ((f as any)?.category || "").toString().trim();
      if (f && lineKey && category) {
        if (status === "rejected") {
          await supabaseAdmin.from("finding_exceptions").upsert({
            org_id: (f as any).org_id,
            line_key: lineKey,
            category,
            procedure_number: ci.procedure_number || null,
            hcpcs: ci.hcpcs_cpt_code || null,
            reason: typeof note === "string" ? note : null,
            status: "active",
            snapshot_charge: ci.gross_charge ?? null,
            snapshot_impact: (f as any).financial_impact ?? null,
            first_rejected_audit_id: (f as any).audit_id,
            last_seen_audit_id: (f as any).audit_id,
            rejected_by: user.id,
            updated_at: new Date().toISOString(),
          }, { onConflict: "org_id,line_key,category" });
        } else if (status === "open" || status === "accepted" || status === "resolved") {
          // No longer a standing exception — stop carrying it forward.
          await supabaseAdmin.from("finding_exceptions")
            .update({ status: "cleared", updated_at: new Date().toISOString() })
            .eq("org_id", (f as any).org_id).eq("line_key", lineKey).eq("category", category);
        }
      }
    } catch (ledgerErr) {
      console.error("exception ledger error:", ledgerErr);
      // Non-fatal: the finding update already succeeded.
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
