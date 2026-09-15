import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { changeFieldForCategory, changeActionForCategory } from "@/lib/change-log";

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

    // Open · Under Review (in_review) · Accepted · Denied (rejected) · N/A (na).
    // "resolved" is kept for backward compatibility with older rows/flows.
    const validStatuses = ["open", "in_review", "accepted", "rejected", "na", "resolved"];
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

    // Carry-forward ledger + change log both key off the finding + its line.
    try {
      const { data: f } = await supabaseAdmin
        .from("findings")
        .select("org_id, audit_id, category, title, recommendation, financial_impact, charge_items(procedure_number, hcpcs_cpt_code, charge_description, revenue_code, modifier_1, gross_charge)")
        .eq("id", findingId)
        .single();
      const ci: any = (f as any)?.charge_items || {};
      const lineKey: string = (ci.procedure_number || ci.hcpcs_cpt_code || "").toString().trim();
      const category: string = ((f as any)?.category || "").toString().trim();
      if (f && lineKey && category) {
        // ── Change log: accepting a finding stages a PENDING change (does not
        // touch the baseline). Reopening/rejecting voids a still-pending change.
        if (status === "accepted") {
          const action_type = changeActionForCategory(category);
          const field = changeFieldForCategory(category);
          const old_value = field === "price" ? (ci.gross_charge != null ? String(ci.gross_charge) : null)
            : field === "description" ? (ci.charge_description || null)
            : field === "revenue_code" ? (ci.revenue_code || null)
            : field === "modifier" ? (ci.modifier_1 || null)
            : field === "hcpcs" ? (ci.hcpcs_cpt_code || null) : null;
          // Best-effort new value: for a price change, pull a $ figure from the
          // recommendation; otherwise the reviewer fills it in on the Change Log.
          let new_value: string | null = null;
          const rec = String((f as any).recommendation || "");
          if (field === "price") { const m = rec.replace(/,/g, "").match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/); if (m) new_value = m[1]; }
          const rationale = (f as any).recommendation || (f as any).title || null;

          const { data: existing } = await supabaseAdmin
            .from("cdm_change_log")
            .select("id")
            .eq("org_id", (f as any).org_id).eq("line_key", lineKey).eq("field", field).neq("status", "void")
            .maybeSingle();
          if (existing) {
            await supabaseAdmin.from("cdm_change_log").update({
              action_type, old_value, new_value, rationale, status: "pending",
              source_finding_id: findingId, approver: user.id, audit_id: (f as any).audit_id,
              procedure_number: ci.procedure_number || null, hcpcs: ci.hcpcs_cpt_code || null,
              description: ci.charge_description || null, updated_at: new Date().toISOString(),
            }).eq("id", (existing as any).id);
          } else {
            const { data: maxRow } = await supabaseAdmin
              .from("cdm_change_log").select("change_number").eq("org_id", (f as any).org_id)
              .order("change_number", { ascending: false }).limit(1).maybeSingle();
            const change_number = (((maxRow as any)?.change_number as number) || 0) + 1;
            await supabaseAdmin.from("cdm_change_log").insert({
              org_id: (f as any).org_id, audit_id: (f as any).audit_id, change_number,
              line_key: lineKey, procedure_number: ci.procedure_number || null, hcpcs: ci.hcpcs_cpt_code || null,
              description: ci.charge_description || null, action_type, field, old_value, new_value, rationale,
              status: "pending", source_finding_id: findingId, requested_by: user.id, approver: user.id,
            });
          }
        } else if (status === "open" || status === "in_review" || status === "rejected" || status === "na") {
          // Un-accepting voids a change that hasn't been exported yet.
          await supabaseAdmin.from("cdm_change_log")
            .update({ status: "void", updated_at: new Date().toISOString() })
            .eq("source_finding_id", findingId).eq("status", "pending");
        }

        // ── Disposition memory (drives carry-forward + finding tiers on the next
        // scan). Denied (rejected) and N/A are standing exceptions carried forward;
        // Accepted is remembered (for tier 2) but not carried; reopening clears it.
        const baseEx = {
          org_id: (f as any).org_id,
          line_key: lineKey,
          category,
          procedure_number: ci.procedure_number || null,
          hcpcs: ci.hcpcs_cpt_code || null,
          reason: typeof note === "string" ? note : null,
          snapshot_charge: ci.gross_charge ?? null,
          snapshot_impact: (f as any).financial_impact ?? null,
          first_rejected_audit_id: (f as any).audit_id,
          last_seen_audit_id: (f as any).audit_id,
          rejected_by: user.id,
          updated_at: new Date().toISOString(),
        };
        if (status === "rejected" || status === "na") {
          await supabaseAdmin.from("finding_exceptions").upsert(
            { ...baseEx, disposition: status === "na" ? "na" : "rejected", status: "active" },
            { onConflict: "org_id,line_key,category" }
          );
        } else if (status === "accepted" || status === "resolved") {
          // Remembered for tier 2, but not a standing (carried) exception.
          await supabaseAdmin.from("finding_exceptions").upsert(
            { ...baseEx, disposition: "accepted", status: "cleared" },
            { onConflict: "org_id,line_key,category" }
          );
        } else if (status === "open" || status === "in_review") {
          // Back in the queue — stop carrying it forward (keep disposition history).
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
