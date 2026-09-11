import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Dev-only: dump findings + charge lines for an audit to JSON files in the
// project dir, so an external accuracy audit can read them. Not for production.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function dumpAll(db: any, table: string, cols: string, auditId: string) {
  const rows: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await db.from(table).select(cols).eq("audit_id", auditId).range(off, off + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") return NextResponse.json({ error: "dev only" }, { status: 403 });
  const auditId = new URL(req.url).searchParams.get("auditId");
  if (!auditId) return NextResponse.json({ error: "auditId required" }, { status: 400 });

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    const findings = await dumpAll(db, "findings", "category, severity, financial_impact, status, title, charge_item_id", auditId);
    const items = await dumpAll(db, "charge_items", "id, procedure_number, hcpcs_cpt_code, revenue_code, gross_charge, charge_description, department, modifier_1, modifier_2", auditId);
    const dir = join(process.cwd(), "tmp");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "findings-export.json"), JSON.stringify(findings));
    writeFileSync(join(dir, "charge-items-export.json"), JSON.stringify(items));
    return NextResponse.json({ ok: true, findings: findings.length, items: items.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
