import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx-js-style";

export const maxDuration = 60;

// Export the current chargemaster as Excel. Because resolved findings write their
// fix straight to charge_items, this download reflects every applied correction,
// so it is the "corrected CDM" the client can load back into their system.
const COLS = [
  "procedure_number", "charge_description", "hcpcs_cpt_code", "revenue_code",
  "department", "department_gl", "gross_charge", "unit_of_service",
  "units_billed", "ndc_code", "modifier_1", "modifier_2", "service_line",
];

export async function GET(request: Request) {
  try {
    const auditId = new URL(request.url).searchParams.get("auditId");
    if (!auditId) return NextResponse.json({ error: "Missing auditId" }, { status: 400 });

    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

    const rows: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await db.from("charge_items").select(COLS.join(", ")).eq("audit_id", auditId).order("procedure_number").range(off, off + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }

    const header = COLS;
    const aoa = [header, ...rows.map((r) => COLS.map((c) => r[c] ?? ""))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = COLS.map((c) => ({ wch: c === "charge_description" ? 42 : 15 }));
    const HEAD = { fill: { patternType: "solid", fgColor: { rgb: "0F3A4A" } }, font: { bold: true, color: { rgb: "FFFFFF" } } };
    for (let c = 0; c < header.length; c++) { const a = XLSX.utils.encode_cell({ r: 0, c }); if (ws[a]) ws[a].s = HEAD; }
    const gi = COLS.indexOf("gross_charge");
    for (let i = 0; i < rows.length; i++) { const a = XLSX.utils.encode_cell({ r: i + 1, c: gi }); if (ws[a] && typeof ws[a].v === "number") ws[a].z = "$#,##0.00"; }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Corrected CDM");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const date = new Date().toISOString().split("T")[0];
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="Corrected_CDM_${date}.xlsx"` } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
