"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { TaskStatus, FindingSeverity, FindingStatus } from "@/types";

// ─── Audit Actions ───────────────────────────────────────────

export async function createAudit(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  // Get user's org
  const { data: userData } = await supabase
    .from("users")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!userData) throw new Error("User not found");

  const { data, error } = await supabase.rpc("create_audit_with_phases", {
    p_org_id: userData.org_id,
    p_name: formData.get("name") as string,
    p_hospital_name: formData.get("hospital_name") as string,
    p_description: (formData.get("description") as string) || null,
    p_lead_auditor_id: user.id,
    p_start_date: (formData.get("start_date") as string) || new Date().toISOString().split("T")[0],
  });

  if (error) throw error;
  revalidatePath("/dashboard");
  return data as string; // returns audit UUID
}

export async function updateAuditStatus(auditId: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("audits")
    .update({ status })
    .eq("id", auditId);
  if (error) throw error;
  revalidatePath(`/audits/${auditId}`);
  revalidatePath("/dashboard");
}

// ─── Task Actions ────────────────────────────────────────────

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const updates: Record<string, unknown> = { status };
  if (status === "completed") {
    updates.completed_at = new Date().toISOString();
    updates.completed_by = user?.id;
  } else {
    updates.completed_at = null;
    updates.completed_by = null;
  }

  const { error } = await supabase
    .from("audit_tasks")
    .update(updates)
    .eq("id", taskId);
  if (error) throw error;
  revalidatePath("/audits");
  revalidatePath("/dashboard");
}

// ─── Finding Actions ─────────────────────────────────────────

export async function createFinding(data: {
  audit_id: string;
  phase_id?: string;
  title: string;
  description?: string;
  severity: FindingSeverity;
  category?: string;
  financial_impact?: number;
  recommendation?: string;
  charge_item_id?: string;
  claim_review_id?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: userData } = await supabase
    .from("users")
    .select("org_id")
    .eq("id", user.id)
    .single();

  const { error } = await supabase.from("findings").insert({
    ...data,
    org_id: userData!.org_id,
    created_by: user.id,
  });
  if (error) throw error;
  revalidatePath("/audits");
  revalidatePath("/dashboard");
}

export async function updateFindingStatus(findingId: string, status: FindingStatus) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const updates: Record<string, unknown> = { status };
  if (status === "resolved") {
    updates.resolved_at = new Date().toISOString();
    updates.resolved_by = user?.id;
  }

  const { error } = await supabase
    .from("findings")
    .update(updates)
    .eq("id", findingId);
  if (error) throw error;
  revalidatePath("/audits");
  revalidatePath("/dashboard");
}

// ─── CDM Import Action ──────────────────────────────────────

export async function importChargeItems(
  auditId: string,
  items: Record<string, string>[],
  columnMappings: Record<string, string>
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: userData } = await supabase
    .from("users")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!userData) throw new Error("User not found");

  // Transform CSV rows using column mappings
  const chargeItems = items.map((row) => {
    const mapped: Record<string, unknown> = {
      audit_id: auditId,
      org_id: userData.org_id,
      raw_data: row,
      column_mapping: columnMappings,
    };

    Object.entries(columnMappings).forEach(([targetCol, sourceCol]) => {
      if (sourceCol && row[sourceCol] !== undefined) {
        const val = row[sourceCol];
        if (targetCol === "gross_charge") {
          mapped[targetCol] = parseFloat(val.replace(/[,$]/g, "")) || null;
        } else if (targetCol === "units_billed") {
          mapped[targetCol] = parseInt(val) || 1;
        } else {
          mapped[targetCol] = val || null;
        }
      }
    });

    // Ensure required field
    if (!mapped.charge_description) {
      mapped.charge_description = "UNMAPPED";
    }

    return mapped;
  });

  // Batch insert
  const BATCH_SIZE = 500;
  let inserted = 0;
  for (let i = 0; i < chargeItems.length; i += BATCH_SIZE) {
    const batch = chargeItems.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("charge_items").insert(batch);
    if (error) throw error;
    inserted += batch.length;
  }

  // Update audit total
  await supabase
    .from("audits")
    .update({ total_charge_items: inserted })
    .eq("id", auditId);

  revalidatePath(`/charge-master`);
  revalidatePath(`/dashboard`);
  return inserted;
}

// ─── Comment Actions ─────────────────────────────────────────

export async function addComment(entityType: string, entityId: string, body: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: userData } = await supabase
    .from("users")
    .select("org_id")
    .eq("id", user.id)
    .single();

  const { error } = await supabase.from("comments").insert({
    org_id: userData!.org_id,
    entity_type: entityType,
    entity_id: entityId,
    body,
    author_id: user.id,
  });
  if (error) throw error;
}

// ─── Department Meeting Actions ──────────────────────────────

export async function createDepartmentMeeting(data: {
  audit_id: string;
  department: string;
  scheduled_date?: string;
  scheduled_time?: string;
  estimated_hours?: number;
  location?: string;
  attendees?: string[];
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: userData } = await supabase
    .from("users")
    .select("org_id")
    .eq("id", user.id)
    .single();

  const { error } = await supabase.from("department_meetings").insert({
    ...data,
    org_id: userData!.org_id,
  });
  if (error) throw error;
  revalidatePath("/departments");
}
