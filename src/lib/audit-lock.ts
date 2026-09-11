import type { SupabaseClient } from "@supabase/supabase-js";

// A quarter run with status "completed" is a locked, read-only snapshot.
// Mutation routes (scan, imports, rule settings) call this and refuse to write.
export async function isAuditLocked(db: SupabaseClient, auditId: string): Promise<boolean> {
  const { data } = await db.from("audits").select("status").eq("id", auditId).single();
  return data?.status === "completed";
}
