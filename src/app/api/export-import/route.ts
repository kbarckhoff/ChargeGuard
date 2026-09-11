import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export const maxDuration = 60;

const CONFIG: Record<string, { table: string; cols: string[]; file: string }> = {
  cdm: { table: "charge_items", file: "Charge_Master", cols: ["procedure_number", "charge_description", "hcpcs_cpt_code", "revenue_code", "department", "department_gl", "gross_charge", "unit_of_service", "units_billed", "ndc_code", "modifier_1", "modifier_2", "service_line"] },
  ru: { table: "charge_usage", file: "Revenue_Usage", cols: ["charge_code", "hcpcs", "department", "units", "gross", "visits", "medicare", "mc_adv", "mc_ma"] },
  formulary: { table: "charge_formulary", file: "Formulary", cols: ["charge_code", "status", "ndc", "drug_name", "pkg_amt", "pkg_unit"] },
  claims: { table: "claim_lines", file: "Claims_837", cols: ["claim_id", "rev_code", "hcpcs", "mod1", "mod2", "mod3", "mod4", "units", "line_charge", "service_date", "pos", "dx_primary"] },
  peer: { table: "peer_prices", file: "Peer_Prices", cols: ["competitor", "hcpcs", "gross_charge"] },
};

const csvCell = (v: any) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "";
    const auditId = url.searchParams.get("auditId");
    const cfg = CONFIG[type];
    if (!cfg || !auditId) return NextResponse.json({ error: "Bad request" }, { status: 400 });

    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

    const competitor = url.searchParams.get("competitor");
    const rows: any[] = [];
    for (let off = 0; ; off += 1000) {
      let q = db.from(cfg.table).select(cfg.cols.join(",")).eq("audit_id", auditId);
      if (type === "peer" && competitor) q = q.eq("competitor", competitor);
      const { data, error } = await q.range(off, off + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }

    const header = cfg.cols.join(",");
    const body = rows.map((r) => cfg.cols.map((c) => csvCell(r[c])).join(",")).join("\n");
    const csv = header + "\n" + body;
    const date = new Date().toISOString().split("T")[0];
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${cfg.file}_${date}.csv"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
