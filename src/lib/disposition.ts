// Shared disposition logic for a single finding — used by /api/findings/update
// (one finding) and /api/findings/disposition-group (every line in a to-do
// group). Applies the status, writes the audit-trail activity row, stages/voids
// the change-log entry, and updates the carry-forward exception ledger. Keeping
// it in one place means group and single dispositions behave identically.

import { changeFieldForCategory, changeActionForCategory } from "@/lib/change-log";

type Admin = any;

export const VALID_STATUSES = ["open", "in_review", "accepted", "rejected", "na", "resolved"];

export async function applyDisposition(
  admin: Admin,
  userId: string,
  args: { findingId: string; status: string; note?: string; action_taken?: string; effective_date?: string }
): Promise<{ error?: string }> {
  const { findingId, status, note, action_taken, effective_date } = args;

  const updates: Record<string, unknown> = { status };
  if (typeof note === "string") updates.resolution_note = note;
  if (status === "resolved") {
    updates.resolved_at = new Date().toISOString();
    updates.resolved_by = userId;
  } else if (status === "open") {
    updates.resolved_at = null;
    updates.resolved_by = null;
  }

  const { error } = await admin.from("findings").update(updates).eq("id", findingId);
  if (error) return { error: error.message };

  // Audit log (best-effort).
  try {
    const { data: fa } = await admin.from("findings").select("org_id, audit_id").eq("id", findingId).single();
    if (fa) {
      await admin.from("finding_activity").insert({
        org_id: fa.org_id, audit_id: fa.audit_id, finding_id: findingId,
        actor_id: userId,
        action: status === "rejected" ? "rejected" : status === "accepted" || status === "resolved" ? "accepted" : status === "na" ? "na" : "note",
        note: typeof note === "string" ? note : null,
        action_taken: typeof action_taken === "string" ? (action_taken.trim() || null) : null,
        effective_date: typeof effective_date === "string" ? (effective_date || null) : null,
      });
    }
  } catch { /* best-effort */ }

  // Change log + carry-forward ledger (best-effort; the status update already stuck).
  try {
    const { data: f } = await admin
      .from("findings")
      .select("org_id, audit_id, category, title, recommendation, financial_impact, charge_items(procedure_number, hcpcs_cpt_code, charge_description, revenue_code, modifier_1, gross_charge)")
      .eq("id", findingId)
      .single();
    const ci: any = (f as any)?.charge_items || {};
    const lineKey: string = (ci.procedure_number || ci.hcpcs_cpt_code || "").toString().trim();
    const category: string = ((f as any)?.category || "").toString().trim();
    if (f && lineKey && category) {
      if (status === "accepted") {
        const action_type = changeActionForCategory(category);
        const field = changeFieldForCategory(category);
        const old_value = field === "price" ? (ci.gross_charge != null ? String(ci.gross_charge) : null)
          : field === "description" ? (ci.charge_description || null)
          : field === "revenue_code" ? (ci.revenue_code || null)
          : field === "modifier" ? (ci.modifier_1 || null)
          : field === "hcpcs" ? (ci.hcpcs_cpt_code || null) : null;
        let new_value: string | null = null;
        const rec = String((f as any).recommendation || "");
        if (field === "price") { const m = rec.replace(/,/g, "").match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/); if (m) new_value = m[1]; }
        const rationale = (f as any).recommendation || (f as any).title || null;

        const { data: existing } = await admin
          .from("cdm_change_log")
          .select("id")
          .eq("org_id", (f as any).org_id).eq("line_key", lineKey).eq("field", field).neq("status", "void")
          .maybeSingle();
        if (existing) {
          await admin.from("cdm_change_log").update({
            action_type, old_value, new_value, rationale, status: "pending",
            source_finding_id: findingId, approver: userId, audit_id: (f as any).audit_id,
            procedure_number: ci.procedure_number || null, hcpcs: ci.hcpcs_cpt_code || null,
            description: ci.charge_description || null, updated_at: new Date().toISOString(),
          }).eq("id", (existing as any).id);
        } else {
          const { data: maxRow } = await admin
            .from("cdm_change_log").select("change_number").eq("org_id", (f as any).org_id)
            .order("change_number", { ascending: false }).limit(1).maybeSingle();
          const change_number = (((maxRow as any)?.change_number as number) || 0) + 1;
          await admin.from("cdm_change_log").insert({
            org_id: (f as any).org_id, audit_id: (f as any).audit_id, change_number,
            line_key: lineKey, procedure_number: ci.procedure_number || null, hcpcs: ci.hcpcs_cpt_code || null,
            description: ci.charge_description || null, action_type, field, old_value, new_value, rationale,
            status: "pending", source_finding_id: findingId, requested_by: userId, approver: userId,
          });
        }
      } else if (status === "open" || status === "in_review" || status === "rejected" || status === "na") {
        await admin.from("cdm_change_log")
          .update({ status: "void", updated_at: new Date().toISOString() })
          .eq("source_finding_id", findingId).eq("status", "pending");
      }

      const baseEx = {
        org_id: (f as any).org_id, line_key: lineKey, category,
        procedure_number: ci.procedure_number || null, hcpcs: ci.hcpcs_cpt_code || null,
        reason: typeof note === "string" ? note : null,
        snapshot_charge: ci.gross_charge ?? null,
        snapshot_impact: (f as any).financial_impact ?? null,
        first_rejected_audit_id: (f as any).audit_id,
        last_seen_audit_id: (f as any).audit_id,
        rejected_by: userId, updated_at: new Date().toISOString(),
      };
      if (status === "rejected" || status === "na") {
        await admin.from("finding_exceptions").upsert(
          { ...baseEx, disposition: status === "na" ? "na" : "rejected", status: "active" },
          { onConflict: "org_id,line_key,category" }
        );
      } else if (status === "accepted" || status === "resolved") {
        await admin.from("finding_exceptions").upsert(
          { ...baseEx, disposition: "accepted", status: "cleared" },
          { onConflict: "org_id,line_key,category" }
        );
      } else if (status === "open" || status === "in_review") {
        await admin.from("finding_exceptions")
          .update({ status: "cleared", updated_at: new Date().toISOString() })
          .eq("org_id", (f as any).org_id).eq("line_key", lineKey).eq("category", category);
      }
    }
  } catch { /* non-fatal */ }

  return {};
}
