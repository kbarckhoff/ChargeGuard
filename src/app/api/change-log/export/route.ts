import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx-js-style";

export const maxDuration = 60;

// Generate the updated CDM: take the run's uploaded BASELINE charge_items and
// overlay every accepted (pending/exported) change-log entry on top, then flip
// applied pending entries to "exported". The baseline is never mutated — this is
// a recommendation file the client applies in their EHR.
const COLS = [
  "procedure_number", "charge_description", "hcpcs_cpt_code", "revenue_code",
  "department", "department_gl", "gross_charge", "unit_of_service",
  "units_billed", "ndc_code", "modifier_1", "modifier_2", "service_line", "is_active",
];

const lineKeyOf = (r: any) => (r.procedure_number || r.hcpcs_cpt_code || "").toString().trim();

export async function GET(request: Request) {
  try {
    const auditId = new URL(request.url).searchParams.get("auditId");
    if (!auditId) return NextResponse.json({ error: "Missing auditId" }, { status: 400 });

    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: audit } = await db.from("audits").select("org_id, name, hospital_name").eq("id", auditId).single();
    if (!audit) return NextResponse.json({ error: "Review not found" }, { status: 404 });

    // Baseline rows.
    const rows: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data, error } = await db.from("charge_items").select(COLS.join(", ")).eq("audit_id", auditId).order("procedure_number").range(off, off + 999);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }

    // Accepted changes for this org that aren't already implemented/void.
    const { data: changes } = await db.from("cdm_change_log")
      .select("id, line_key, action_type, field, old_value, new_value, rationale, status, procedure_number, hcpcs, description")
      .eq("org_id", audit.org_id).in("status", ["pending", "exported", "approved_missing"]);
    const changeList = changes || [];

    const byKey: Record<string, any> = {};
    for (const r of rows) byKey[lineKeyOf(r)] = r;

    const applied: any[] = [];
    const appliedIds: string[] = [];
    for (const c of changeList) {
      const target = byKey[(c as any).line_key];
      const apply = (row: any) => {
        const v = (c as any).new_value;
        switch ((c as any).field) {
          case "price": if (v != null && v !== "") row.gross_charge = Number(String(v).replace(/[$,]/g, "")) || row.gross_charge; break;
          case "description": if (v) row.charge_description = v; break;
          case "revenue_code": if (v) row.revenue_code = v; break;
          case "modifier": if (v) row.modifier_1 = v; break;
          case "hcpcs": if (v) row.hcpcs_cpt_code = v; break;
        }
        if ((c as any).action_type === "deactivate") row.is_active = false;
      };
      if (target) { apply(target); applied.push(c); appliedIds.push((c as any).id); }
      else if ((c as any).action_type === "add") {
        const row: any = { procedure_number: (c as any).procedure_number || (c as any).line_key, charge_description: (c as any).description || "", hcpcs_cpt_code: (c as any).hcpcs || "", is_active: true };
        apply(row); rows.push(row); applied.push(c); appliedIds.push((c as any).id);
      }
    }

    // Updated CDM sheet.
    const wb = XLSX.utils.book_new();
    const aoa = [COLS, ...rows.map((r) => COLS.map((c) => (r[c] ?? "")))];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = COLS.map((c) => ({ wch: c === "charge_description" ? 42 : 14 }));
    const HEAD = { fill: { patternType: "solid", fgColor: { rgb: "1F6FD4" } }, font: { bold: true, color: { rgb: "FFFFFF" } } };
    for (let c = 0; c < COLS.length; c++) { const a = XLSX.utils.encode_cell({ r: 0, c }); if (ws[a]) ws[a].s = HEAD; }
    const gi = COLS.indexOf("gross_charge");
    for (let i = 0; i < rows.length; i++) { const a = XLSX.utils.encode_cell({ r: i + 1, c: gi }); if (ws[a] && typeof ws[a].v === "number") ws[a].z = "$#,##0.00"; }
    XLSX.utils.book_append_sheet(wb, ws, "Updated CDM");

    // Change summary sheet.
    const sumHead = ["Line", "HCPCS", "Action", "Field", "Old Value", "New Value", "Rationale"];
    const sumAoa = [sumHead, ...applied.map((c: any) => [c.procedure_number || c.line_key, c.hcpcs || "", c.action_type, c.field, c.old_value ?? "", c.new_value ?? "", c.rationale ?? ""])];
    const sws = XLSX.utils.aoa_to_sheet(sumAoa);
    sws["!cols"] = [{ wch: 16 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 60 }];
    for (let c = 0; c < sumHead.length; c++) { const a = XLSX.utils.encode_cell({ r: 0, c }); if (sws[a]) sws[a].s = HEAD; }
    XLSX.utils.book_append_sheet(wb, sws, "Change Summary");

    // Flip applied pending entries to exported.
    if (appliedIds.length) {
      await db.from("cdm_change_log").update({ status: "exported", exported_at: new Date().toISOString(), updated_at: new Date().toISOString() }).in("id", appliedIds).eq("status", "pending");
    }

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const date = new Date().toISOString().split("T")[0];
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="Updated_CDM_${date}.xlsx"` } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
