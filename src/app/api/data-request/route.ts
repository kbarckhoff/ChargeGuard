import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx-js-style";
import dr from "@/lib/data-request.json";

export const maxDuration = 30;

const thin = { style: "thin", color: { rgb: "BFBFBF" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const TITLE = { fill: { patternType: "solid", fgColor: { rgb: "1F3864" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 }, alignment: { vertical: "center" } };
const SECTION = { fill: { patternType: "solid", fgColor: { rgb: "44546A" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 }, alignment: { vertical: "center" } };
const HEAD = { fill: { patternType: "solid", fgColor: { rgb: "44546A" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: BORDER };
const WHENFILL: Record<string, string> = { Kickoff: "C6E0B4", "Week 2": "BDD7EE", "Phase 2": "FFE699", Optional: "D9D9D9" };
const E = XLSX.utils.encode_cell;
function sty(ws: any, r: number, c: number, s: any) { const a = E({ r, c }); if (!ws[a]) ws[a] = { t: "s", v: "" }; ws[a].s = { ...(ws[a].s || {}), ...s }; }
function merge(ws: any, r: number, c1: number, c2: number) { (ws["!merges"] = ws["!merges"] || []).push({ s: { r, c: c1 }, e: { r, c: c2 } }); }

export async function GET(request: Request) {
  try {
    const auditId = new URL(request.url).searchParams.get("auditId");
    if (!auditId) return NextResponse.json({ error: "Missing auditId" }, { status: 400 });
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const { data: audit } = await db.from("audits").select("hospital_name, name").eq("id", auditId).single();
    const date = new Date().toISOString().split("T")[0];

    const items = (dr as any).items as any[];
    const sections = (dr as any).sections as any[];
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: cover + routing ──
    const cover: any[][] = [
      ["CDM REVIEW — CLIENT DATA REQUEST"],
      [`Engagement: ${audit?.hospital_name || ""}`],
      [`Prepared: ${date}`],
      ["Purpose: Charge Description Master (CDM) review and revenue optimization analysis."],
      [],
      ["TO THE PROJECT COORDINATOR"],
      ["Each lettered section is owned by a specific department. Forward each section to the named owner and collect responses by the timing shown. Sections A–H apply to all facility types; Section I has facility-specific sub-sections — complete only the one matching your facility."],
      [],
      ["TIMING KEY"],
      ["Kickoff = needed before the engagement starts   |   Week 2 = within two weeks   |   Phase 2 = after the initial report (12-month claims, cost-report CCR, EHR implant log)   |   Optional = if available"],
      [],
      ["SECTION ROUTING"],
      ["Section", "Forward to"],
      ...sections.map((s) => [s.section, s.forward.replace(/^Forward this section to:\s*/i, "")]),
    ];
    const cws = XLSX.utils.aoa_to_sheet(cover);
    cws["!cols"] = [{ wch: 52 }, { wch: 70 }];
    sty(cws, 0, 0, TITLE); merge(cws, 0, 0, 1);
    [5, 8, 11].forEach((r) => { sty(cws, r, 0, SECTION); merge(cws, r, 0, 1); });
    sty(cws, 12, 0, HEAD); sty(cws, 12, 1, HEAD);
    for (let i = 0; i < sections.length; i++) { sty(cws, 13 + i, 0, { border: BORDER, font: { bold: true } }); sty(cws, 13 + i, 1, { border: BORDER, alignment: { wrapText: true } }); }
    XLSX.utils.book_append_sheet(wb, cws, "Instructions");

    // ── Sheet 2: data request matrix ──
    const headers = ["Item", "Data Requested", "Primary Owner", "Secondary Owner", "Facility Type", "When Needed", "Provided? (Y/N)", "Notes"];
    const aoa = [headers, ...items.map((it) => [it.item, it.desc, it.owner, it.secondary, it.scope, it.when, "", ""])];
    const mws = XLSX.utils.aoa_to_sheet(aoa);
    mws["!cols"] = [{ wch: 9 }, { wch: 46 }, { wch: 20 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 30 }];
    for (let c = 0; c < headers.length; c++) sty(mws, 0, c, HEAD);
    for (let i = 0; i < items.length; i++) {
      const r = i + 1;
      for (let c = 0; c < headers.length; c++) sty(mws, r, c, { border: BORDER, alignment: { vertical: "top", wrapText: true } });
      sty(mws, r, 0, { border: BORDER, font: { bold: true } });
      const w = items[i].when;
      if (WHENFILL[w]) sty(mws, r, 5, { border: BORDER, fill: { patternType: "solid", fgColor: { rgb: WHENFILL[w] } }, alignment: { horizontal: "center" } });
    }
    mws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: items.length, c: headers.length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, mws, "Data Request");

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const name = (audit?.hospital_name || "Client").replace(/[^a-zA-Z0-9]/g, "_");
    return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="ChargeGuard_${name}_Data_Request_${date}.xlsx"` } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
