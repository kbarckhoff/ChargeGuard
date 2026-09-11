// Departments = the permission scope for users AND the auto-routing target for
// findings. Kept in one place so signup seeding and the scan use the same list.
import type { SupabaseClient } from "@supabase/supabase-js";

export type DeptSeed = { code: string; name: string; sort: number };

export const DEFAULT_DEPARTMENTS: DeptSeed[] = [
  { code: "pharmacy", name: "Pharmacy", sort: 10 },
  { code: "laboratory", name: "Laboratory", sort: 20 },
  { code: "radiology", name: "Radiology/Imaging", sort: 30 },
  { code: "cardiology", name: "Cardiology", sort: 40 },
  { code: "surgery", name: "Surgery/OR & Anesthesia", sort: 50 },
  { code: "emergency", name: "Emergency", sort: 60 },
  { code: "respiratory", name: "Respiratory/Pulmonary", sort: 70 },
  { code: "therapy", name: "Therapy Services", sort: 80 },
  { code: "supply", name: "Supply Chain/Materials", sort: 90 },
  { code: "nursing", name: "Nursing/Clinical", sort: 100 },
  { code: "revenue_cycle", name: "Revenue Cycle/HIM", sort: 110 },
  { code: "unassigned", name: "Unassigned/Other", sort: 999 },
];

// UB-04 revenue-code prefix (first 3 digits) -> department code.
export const DEFAULT_REV_MAP: Record<string, string> = {
  "025": "pharmacy", "063": "pharmacy",
  "030": "laboratory", "031": "laboratory",
  "032": "radiology", "035": "radiology", "040": "radiology", "061": "radiology",
  "048": "cardiology", "073": "cardiology",
  "036": "surgery", "037": "surgery", "049": "surgery", "071": "surgery",
  "045": "emergency",
  "041": "respiratory", "046": "respiratory",
  "042": "therapy", "043": "therapy", "044": "therapy",
  "027": "supply", "062": "supply",
  "010": "nursing", "011": "nursing", "012": "nursing", "013": "nursing",
  "014": "nursing", "016": "nursing", "021": "nursing", "076": "nursing",
};

// Pure CDM-integrity / coding findings the chargemaster (HIM/Revenue Cycle) owns,
// regardless of which clinical department the line sits in — a clinical
// department can't fix a code or a revenue-code assignment. Matched as
// case-insensitive substrings against the finding category.
const STRUCTURAL_CATEGORY_HINTS = [
  "retired hcpcs", "missing code", "description", "revenue code", "multi rev code",
  "compliance", "modifier", "add-on", "duplicate", "recommended code", "coding opportunity",
];

// True when a finding is a CDM-integrity/coding issue the chargemaster team owns.
export function isStructuralCategory(category: string | null | undefined): boolean {
  const cat = (category || "").toLowerCase();
  return STRUCTURAL_CATEGORY_HINTS.some((h) => cat.includes(h));
}

// Decide the owning department CODE for a finding: structural -> revenue_cycle;
// otherwise route by the line's revenue code; else unassigned.
export function resolveDepartmentCode(
  category: string | null | undefined,
  revenueCode: string | null | undefined,
  revMap: Record<string, string> = DEFAULT_REV_MAP,
): string {
  const cat = (category || "").toLowerCase();
  if (STRUCTURAL_CATEGORY_HINTS.some((h) => cat.includes(h))) return "revenue_cycle";
  const digits = (revenueCode || "").replace(/[^0-9]/g, "");
  const p3 = digits.slice(0, 3);
  if (p3 && revMap[p3]) return revMap[p3];
  return "unassigned";
}

// Seed the default departments + revenue-code map for an org (idempotent).
export async function seedOrgDepartments(db: SupabaseClient, orgId: string): Promise<void> {
  await db.from("departments").upsert(
    DEFAULT_DEPARTMENTS.map((d) => ({ org_id: orgId, code: d.code, name: d.name, sort_order: d.sort })),
    { onConflict: "org_id,code", ignoreDuplicates: true },
  );
  const { data: depts } = await db.from("departments").select("id, code").eq("org_id", orgId);
  const idByCode: Record<string, string> = {};
  for (const d of depts || []) idByCode[(d as any).code] = (d as any).id;
  const rows = Object.entries(DEFAULT_REV_MAP)
    .map(([prefix, code]) => ({ org_id: orgId, rev_prefix: prefix, department_id: idByCode[code] }))
    .filter((r) => r.department_id);
  if (rows.length) {
    await db.from("revenue_code_departments").upsert(rows, { onConflict: "org_id,rev_prefix", ignoreDuplicates: true });
  }
}

// Load an org's rev-prefix -> department_id map + code -> department_id map.
export async function loadDeptMaps(db: SupabaseClient, orgId: string): Promise<{
  idByCode: Record<string, string>;
  deptIdByPrefix: Record<string, string>;
}> {
  const { data: depts } = await db.from("departments").select("id, code").eq("org_id", orgId);
  const idByCode: Record<string, string> = {};
  for (const d of depts || []) idByCode[(d as any).code] = (d as any).id;
  const { data: rev } = await db.from("revenue_code_departments").select("rev_prefix, department_id").eq("org_id", orgId);
  const deptIdByPrefix: Record<string, string> = {};
  for (const r of rev || []) deptIdByPrefix[(r as any).rev_prefix] = (r as any).department_id;
  return { idByCode, deptIdByPrefix };
}
