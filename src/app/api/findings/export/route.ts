import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { bucketForCategory, BUCKET_LABELS, type FindingBucket } from "@/lib/finding-buckets";
import { classForCategory, CLASS_LABELS } from "@/lib/finding-class";
import * as XLSX from "xlsx-js-style";

export const maxDuration = 60;

// Export findings as an Excel workbook, redesigned as ChargeGuard's own report:
// a titled, branded banner on every sheet, a leading Summary sheet, zebra rows,
// and per-sheet totals. bucket=all builds Summary + one sheet per findings-page
// tab (CDM, RVU, Formulary, Peer Review); a single bucket builds that one sheet.
const BUCKET_ORDER: FindingBucket[] = ["cdm", "rvu", "formulary", "peer"];

// ── Palette (ChargeGuard brand) ──
const INK = "1E2A44";       // deep navy banner
const BRAND = "0A6CFF";     // ChargeGuard blue
const TINT = "EEF3FF";      // light blue summary strip
const ZEBRA = "F7F9FC";     // alt row
const LINE = "D9DEE8";      // hairline border

const thin = { style: "thin", color: { rgb: LINE } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
const MONEY = '"$"#,##0';

const TITLE = { font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } }, fill: { patternType: "solid", fgColor: { rgb: INK } }, alignment: { vertical: "center", horizontal: "left" } };
const SUBTITLE = { font: { sz: 10, color: { rgb: "C4D2E8" } }, fill: { patternType: "solid", fgColor: { rgb: INK } }, alignment: { vertical: "center", horizontal: "left" } };
const SUMBAR = { font: { bold: true, sz: 11, color: { rgb: INK } }, fill: { patternType: "solid", fgColor: { rgb: TINT } }, alignment: { vertical: "center", horizontal: "left" } };
const COLHEAD = { fill: { patternType: "solid", fgColor: { rgb: BRAND } }, font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: BORDER };
const TOTALLBL = { font: { bold: true, color: { rgb: INK } }, alignment: { horizontal: "right" }, border: { top: { style: "medium", color: { rgb: BRAND } } } };
const TOTALVAL = { font: { bold: true, color: { rgb: INK } }, numFmt: MONEY, border: { top: { style: "medium", color: { rgb: BRAND } } } };

const STATUS: Record<string, string> = { open: "Open", in_review: "Under Review", accepted: "Accepted", rejected: "Denied", na: "N/A", resolved: "Accepted" };
const TIER: Record<number, string> = { 1: "1 - New", 2: "2 - Accepted before", 3: "3 - Denied before", 4: "4 - N/A before" };

const HEADERS = ["Work type", "Tier", "Status", "Severity", "Category", "Finding", "Charge Code", "HCPCS/CPT", "Rev Code", "Description", "Price", "Est. Impact", "Detail", "Recommendation", "Reviewer Note"];
const COLS = [{ wch: 14 }, { wch: 18 }, { wch: 12 }, { wch: 9 }, { wch: 26 }, { wch: 40 }, { wch: 12 }, { wch: 11 }, { wch: 9 }, { wch: 34 }, { wch: 11 }, { wch: 12 }, { wch: 50 }, { wch: 48 }, { wch: 28 }];
const NCOL = HEADERS.length;
const IMPACT_COL = 11, PRICE_COL = 10;
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

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

// A titled banner (3 rows) + spacer that sits above the table on every sheet.
function banner(title: string, facility: string, period: string, summary: string) {
  return [[title], [`${facility}  ·  ${period}  ·  Generated ${new Date().toLocaleDateString()}`], [summary], [""]];
}
const BANNER_ROWS = 4; // title, subtitle, summary, spacer

function styleBanner(ws: any) {
  const span = (r: number) => ({ s: { r, c: 0 }, e: { r, c: NCOL - 1 } });
  ws["!merges"] = [span(0), span(1), span(2)];
  const set = (addr: string, s: any) => { if (!ws[addr]) ws[addr] = { t: "s", v: "" }; ws[addr].s = s; };
  set("A1", TITLE); set("A2", SUBTITLE); set("A3", SUMBAR);
  // paint the merged banner cells so the fill spans the full width
  for (let c = 0; c < NCOL; c++) {
    const a1 = XLSX.utils.encode_cell({ r: 0, c }); if (!ws[a1]) ws[a1] = { t: "s", v: "" }; ws[a1].s = TITLE;
    const a2 = XLSX.utils.encode_cell({ r: 1, c }); if (!ws[a2]) ws[a2] = { t: "s", v: "" }; ws[a2].s = SUBTITLE;
    const a3 = XLSX.utils.encode_cell({ r: 2, c }); if (!ws[a3]) ws[a3] = { t: "s", v: "" }; ws[a3].s = SUMBAR;
  }
}

function buildSheet(rows: any[], title: string, facility: string, period: string) {
  const totalImpact = rows.reduce((s, r) => s + (Number(r.financial_impact) || 0), 0);
  const summary = `${rows.length.toLocaleString()} finding${rows.length === 1 ? "" : "s"}  ·  ${money(totalImpact)} estimated impact`;
  const body = rows.map(rowFor);
  const aoa = [...banner(title, facility, period, summary), HEADERS, ...body];
  const headerRow = BANNER_ROWS; // 0-indexed row of the column headers
  const firstData = headerRow + 1;
  const totalRow = firstData + body.length;
  // totals row
  aoa.push(["", "", "", "", "", "", "", "", "", "", "Total", totalImpact, "", "", ""]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = COLS;
  ws["!rows"] = [{ hpt: 24 }, { hpt: 15 }, { hpt: 18 }];
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: 0 }, e: { r: Math.max(headerRow, totalRow - 1), c: NCOL - 1 } }) };
  styleBanner(ws);

  // Column headers
  for (let c = 0; c < NCOL; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRow, c });
    if (ws[addr]) ws[addr].s = COLHEAD;
  }
  // Body: borders, zebra, money format
  for (let i = 0; i < body.length; i++) {
    const r = firstData + i;
    const zebra = i % 2 === 1;
    for (let c = 0; c < NCOL; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (!ws[addr]) continue;
      ws[addr].s = {
        border: BORDER,
        alignment: { vertical: "top", wrapText: c >= 9 && c !== PRICE_COL && c !== IMPACT_COL },
        ...(zebra ? { fill: { patternType: "solid", fgColor: { rgb: ZEBRA } } } : {}),
      };
      if (c === PRICE_COL || c === IMPACT_COL) { ws[addr].t = "n"; ws[addr].z = MONEY; ws[addr].s = { ...ws[addr].s, numFmt: MONEY, alignment: { horizontal: "right" } }; }
    }
  }
  // Totals row
  const tl = XLSX.utils.encode_cell({ r: totalRow, c: IMPACT_COL - 1 }); if (ws[tl]) ws[tl].s = TOTALLBL;
  const tv = XLSX.utils.encode_cell({ r: totalRow, c: IMPACT_COL }); if (ws[tv]) { ws[tv].t = "n"; ws[tv].z = MONEY; ws[tv].s = TOTALVAL; }

  // Freeze the banner + header so the table scrolls under it.
  ws["!freeze"] = { xSplit: 0, ySplit: firstData, topLeftCell: XLSX.utils.encode_cell({ r: firstData, c: 0 }), activePane: "bottomLeft", state: "frozen" };
  return ws;
}

// Leading overview sheet: totals by work type and by report section.
function buildSummarySheet(rows: any[], facility: string, period: string) {
  const byClass = new Map<string, { n: number; imp: number }>();
  const byBucket = new Map<string, { n: number; imp: number }>();
  for (const r of rows) {
    const cls = CLASS_LABELS[classForCategory(r.category)];
    const bkt = BUCKET_LABELS[bucketForCategory(r.category)];
    const imp = Number(r.financial_impact) || 0;
    const a = byClass.get(cls) || { n: 0, imp: 0 }; a.n++; a.imp += imp; byClass.set(cls, a);
    const b = byBucket.get(bkt) || { n: 0, imp: 0 }; b.n++; b.imp += imp; byBucket.set(bkt, b);
  }
  const totalImp = rows.reduce((s, r) => s + (Number(r.financial_impact) || 0), 0);
  const aoa: any[][] = [
    ...banner("ChargeGuard — Findings Report", facility, period, `${rows.length.toLocaleString()} findings  ·  ${money(totalImp)} estimated impact`),
    ["By work type", "", "Findings", "Est. Impact"],
    ...[...byClass.entries()].map(([k, v]) => [k, "", v.n, v.imp]),
    ["", "", "", ""],
    ["By report section", "", "Findings", "Est. Impact"],
    ...[...byBucket.entries()].map(([k, v]) => [k, "", v.n, v.imp]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 26 }, { wch: 3 }, { wch: 12 }, { wch: 16 }];
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 3 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 3 } }];
  styleBanner4(ws);
  // Section header rows
  const SECT = { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { patternType: "solid", fgColor: { rgb: BRAND } }, alignment: { horizontal: "left" }, border: BORDER };
  const SECTNUM = { ...SECT, alignment: { horizontal: "center" } };
  for (const hr of [4, 4 + byClass.size + 2]) {
    for (const c of [0, 1, 2, 3]) {
      const addr = XLSX.utils.encode_cell({ r: hr, c });
      if (ws[addr]) ws[addr].s = c >= 2 ? SECTNUM : SECT;
    }
  }
  // Money format on impact column everywhere below the banner
  for (let r = 5; r < aoa.length; r++) {
    const a = XLSX.utils.encode_cell({ r, c: 3 });
    if (ws[a] && typeof ws[a].v === "number") { ws[a].t = "n"; ws[a].z = MONEY; ws[a].s = { numFmt: MONEY }; }
  }
  return ws;
}
// Summary sheet banner spans 4 cols.
function styleBanner4(ws: any) {
  const set = (r: number, s: any) => { for (let c = 0; c < 4; c++) { const a = XLSX.utils.encode_cell({ r, c }); if (!ws[a]) ws[a] = { t: "s", v: "" }; ws[a].s = s; } };
  set(0, TITLE); set(1, SUBTITLE); set(2, SUMBAR);
  ws["!rows"] = [{ hpt: 24 }, { hpt: 15 }, { hpt: 18 }];
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

    const { data: audit } = await db.from("audits").select("hospital_name, name, metadata").eq("id", auditId).eq("org_id", userData.org_id).maybeSingle();
    const facility = (audit as any)?.hospital_name || (audit as any)?.name || "Facility";
    const period = ((audit as any)?.metadata?.review_period) || "Current review";

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
    // Lead with the Summary sheet when exporting everything.
    if (isAll) XLSX.utils.book_append_sheet(wb, buildSummarySheet(rows, facility, period), "Summary");

    const buckets = isAll ? BUCKET_ORDER : [bucketParam as FindingBucket];
    let sheetsAdded = 0;
    for (const b of buckets) {
      const subset = rows.filter((r) => bucketForCategory(r.category) === b);
      if (isAll && subset.length === 0) continue; // skip empty tabs when exporting all
      const label = BUCKET_LABELS[b] || "Findings";
      XLSX.utils.book_append_sheet(wb, buildSheet(subset, `ChargeGuard — ${label}`, facility, period), label.slice(0, 31));
      sheetsAdded++;
    }
    if (sheetsAdded === 0 && !isAll) {
      const b = bucketParam as FindingBucket;
      XLSX.utils.book_append_sheet(wb, buildSheet([], `ChargeGuard — ${BUCKET_LABELS[b] || "Findings"}`, facility, period), (BUCKET_LABELS[b] || "Findings").slice(0, 31));
    }

    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const fname = isAll ? "chargeguard-findings-report.xlsx" : `${BUCKET_LABELS[bucketParam as FindingBucket]?.replace(/\s+/g, "-").toLowerCase() || "findings"}.xlsx`;
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
