import { createClient } from "@/lib/supabase/server";
import type { Audit, AuditPhase, AuditTask, Finding } from "@/types";

export async function getAudits() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audits")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Audit[];
}

export async function getAudit(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audits")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as Audit;
}

export async function getAuditPhases(auditId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_phases")
    .select("*")
    .eq("audit_id", auditId)
    .order("phase_number");
  if (error) throw error;
  return data as AuditPhase[];
}

export async function getPhaseTasks(phaseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_tasks")
    .select("*")
    .eq("phase_id", phaseId)
    .order("sort_order");
  if (error) throw error;
  return data as AuditTask[];
}

export async function getPhaseFindings(phaseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("findings")
    .select("*")
    .eq("phase_id", phaseId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Finding[];
}

export async function getAuditFindings(auditId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("findings")
    .select("*")
    .eq("audit_id", auditId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Finding[];
}

export async function getAuditStats(auditId: string) {
  const supabase = await createClient();

  const [findings, tasks, claims, chargeItems] = await Promise.all([
    supabase.from("findings").select("id, severity, status, financial_impact").eq("audit_id", auditId),
    supabase.from("audit_tasks").select("id, status").eq("audit_id", auditId),
    supabase.from("claim_reviews").select("id, is_reviewed, claim_type").eq("audit_id", auditId),
    supabase.from("charge_items").select("id", { count: "exact", head: true }).eq("audit_id", auditId),
  ]);

  const findingsData = findings.data || [];
  const tasksData = tasks.data || [];
  const claimsData = claims.data || [];

  return {
    totalChargeItems: chargeItems.count || 0,
    totalFindings: findingsData.length,
    openFindings: findingsData.filter((f) => f.status === "open").length,
    totalImpact: findingsData.reduce((s, f) => s + (f.financial_impact || 0), 0),
    totalTasks: tasksData.length,
    completedTasks: tasksData.filter((t) => t.status === "completed").length,
    totalClaims: claimsData.length,
    reviewedClaims: claimsData.filter((c) => c.is_reviewed).length,
    severityCounts: {
      critical: findingsData.filter((f) => f.severity === "critical").length,
      high: findingsData.filter((f) => f.severity === "high").length,
      medium: findingsData.filter((f) => f.severity === "medium").length,
      low: findingsData.filter((f) => f.severity === "low").length,
      info: findingsData.filter((f) => f.severity === "info").length,
    },
  };
}
