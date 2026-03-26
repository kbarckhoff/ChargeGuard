import { createClient } from "@/lib/supabase/server";
import type { ChargeItem, CdmImportConfig } from "@/types";

export async function getChargeItems(
  auditId: string,
  options?: {
    page?: number;
    pageSize?: number;
    search?: string;
    colorFilter?: string;
    department?: string;
  }
) {
  const supabase = await createClient();
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 25;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("charge_items")
    .select("*", { count: "exact" })
    .eq("audit_id", auditId)
    .order("procedure_number");

  if (options?.search) {
    query = query.or(
      `charge_description.ilike.%${options.search}%,hcpcs_cpt_code.ilike.%${options.search}%,procedure_number.ilike.%${options.search}%`
    );
  }
  if (options?.colorFilter && options.colorFilter !== "all") {
    query = query.eq("cdm_color", options.colorFilter);
  }
  if (options?.department) {
    query = query.eq("department", options.department);
  }

  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    items: data as ChargeItem[],
    total: count || 0,
    page,
    pageSize,
    totalPages: Math.ceil((count || 0) / pageSize),
  };
}

export async function getChargeItemDepartments(auditId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("charge_items")
    .select("department")
    .eq("audit_id", auditId)
    .not("department", "is", null);

  if (error) throw error;
  const unique = [...new Set((data || []).map((d) => d.department).filter(Boolean))];
  return unique.sort();
}

export async function getImportConfigs() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cdm_import_configs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as CdmImportConfig[];
}

export async function saveImportConfig(config: {
  name: string;
  column_mappings: Record<string, string>;
  sample_headers: string[];
  org_id: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cdm_import_configs")
    .insert(config)
    .select()
    .single();
  if (error) throw error;
  return data as CdmImportConfig;
}

export async function bulkInsertChargeItems(
  items: Partial<ChargeItem>[]
) {
  const supabase = await createClient();
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("charge_items").insert(batch);
    if (error) throw error;
    inserted += batch.length;
  }

  return inserted;
}
