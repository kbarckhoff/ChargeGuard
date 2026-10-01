import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { bucketForCategory, BUCKET_LABELS, type FindingBucket } from "@/lib/finding-buckets";
import { classForCategory, CLASS_LABELS } from "@/lib/finding-class";
import * as XLSX from "xlsx-js-style";

export const maxDuration = 60;

// Export findings as an Excel workbook. bucket=all builds one sheet per findings-
// page tab (CDM, RVU, Formulary, Peer Review); a single bucket builds that one
// sheet. Mirrors the tabs the reviewer sees on the Findings page.
const BUCKET_ORDER: FindingBucket[] = ["cdm", "rvu", "formulary", "peer"];

const thin = { style: "thin", color: { rgb: "BFBFBF" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const COLHEAD = { fill: { patternType: "solid", fgColor: { rgb: "44546A" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: BORDER };
const MONEY = '"$"#,##0';

const STATUS: Record<string, string> = { open: "Open", in_review: "Under Review", accepted: "Accepted", rejected: "Denied", na: "N/A", resolved: "Accepted" };
const TIER: Record<number, string> = { 1: "1 - New", 2: "2 - Accepted before", 3: "3 - Denied before", 4: "4 - N/A before" };

const HEADERS = ["Work type", "Tier", "Status", "Severity", "Category", "Finding", "Charge Code", "HCPCS/CPT", "Rev Code", "Description", "Price", "Est. Impact", "Detail", "Recommendation", "Reviewer Note"];
const COLS = [{ wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 9 }, { wch: 26 }, { wch: 40 }, { wch: 12 }, { wch: 11 }, { wch: 9 }, { wch: 34 }, { wch: 11 }, { wch: 12 }, { wch: 50 }, { wch: 48 }, { wch: 28 }];

function rowFor(r: any): any[] {
  const ci = r.charge_items || {};
  return [
    CLASS_LABELS[classForCategory(r.category)],
    TIER[r.tier] || (r.tier ?? ""),
    STATUS[r.status] || r.status,
    r.severity,
    r.category,
    r.title,
    ci.procedure_number ?? "",
    ci.hcpcs_cpt_code ?? "",
    ci.revenue_code ?? "",
    ci.charge_description ?? "",
    ci.gross_charge ?? "",
    r.financial_impact ?? "",
    r.description ?? "",
    r.recommendation ?? "",
    r.resolution_note ?? "",
  ];
}

function buildSheet(rows: any[]) {
  const aoa = [HEADERS, ...rows.map(rowFor)];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = COLS;
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, aoa.length - 1), c: HEADERS.length - 1 } }) };
  // Header styling
  for (let c = 0; c < HEADERS.length; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[addr]) ws[addr].s = COLHEAD;
  }
  // Body: borders + money format on Price / Est. Impact
  for (let i = 1; i < aoa.length; i++) {
    for (let c = 0; c < HEADERS.length; c++) {
      const addr = XLSX.utils.encode_cell({ r: i, c });
      if (!ws[addr]) continue;
      ws[addr].s = { ...(ws[addr].s || {}), border: BORDER, alignment: { vertical: "top", wrapText: c >= 9 } };
      if (c === 10 || c === 11) { ws[addr].t = "n"; ws[addr].z = MONEY; ws[addr].s = { ...ws[addr].s, numFmt: MONEY }; }
    }
  }
  return ws;
}

export async function GET(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: userData } = await db.from("users").select("org_id").eq("id", user.id).single();
    if (!userData) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { searchParams } = new URL(request.url);
    const auditId = searchParams.get("auditId");
    const bucketParam = searchParams.get("bucket") || "all";
    const isAll = bucketParam === "all";
    if (!auditId) return NextResponse.json({ error: "auditId is required" }, { status: 400 });

    // Page through all findings for the audit (Supabase caps at 1000/response).
    const rows: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await db
        .from("findings")
        .select("tier, status, severity, category, title, description, recommendation, financial_impact, resolution_note, charge_items(procedure_number, hcpcs_cpt_code, revenue_code, charge_description, gross_charge)")
        .eq("audit_id", auditId)
        .eq("org_id", userData.org_id)
        .eq("ehr_lagging", false)
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error || !data || data.length === 0) break;
      rows.push(...data);
      if (data.length < 1000) break;
    }

    const wb = XLSX.utils.book_new();
    const buckets = isAll ? BUCKET_ORDER : [bucketParam as FindingBucket];
    let sheetsAdded = 0;
    for (const b of buckets) {
      const subset = rows.filter((r) => bucketForCategory(r.category) === b);
      if (isAll && subset.length === 0) continue; // skip empty tabs when exporting all
      const label = BUCKET_LABELS[b] || "Findings";
      XLSX.utils.book_append_sheet(wb, buildSheet(subset), label.slice(0, 31));
      sheetsAdded++;
    }
    if (sheetsAdded === 0) {
      // Nothing matched — still return a (possibly empty) sheet so the file opens.
      const b = (isAll ? "cdm" : bucketParam) as FindingBucket;
      XLSX.utils.book_append_sheet(wb, buildSheet([]), (BUCKET_LABELS[b] || "Findings").slice(0, 31));
    }

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const fname = isAll ? "all-findings.xlsx" : `${BUCKET_LABELS[bucketParam as FindingBucket]?.replace(/\s+/g, "-").toLowerCase() || "findings"}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
