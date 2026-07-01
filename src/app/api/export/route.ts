import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import * as XLSX from "xlsx-js-style";

export const maxDuration = 60;

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const PRIORITY: Record<string, string> = { critical: "CRITICAL", high: "HIGH", medium: "MEDIUM", low: "LOW", info: "INFO" };
const num = (v: any) => { const n = parseFloat(String(v ?? "").replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; };

// ── Style palette (mirrors Greg's report) ──
const MONEY = '"$"#,##0';
const thin = { style: "thin", color: { rgb: "BFBFBF" } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };
// Greg's exact palette
const TITLE = { fill: { patternType: "solid", fgColor: { rgb: "1F3864" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 14 }, alignment: { vertical: "center" } };
const SUBTITLE = { fill: { patternType: "solid", fgColor: { rgb: "2E4057" } }, font: { color: { rgb: "FFFFFF" }, sz: 10 }, alignment: { vertical: "center" } };
const SECTION = { fill: { patternType: "solid", fgColor: { rgb: "44546A" } }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 11 }, alignment: { vertical: "center" } };
const FLAGBANNER = { fill: { patternType: "solid", fgColor: { rgb: "F4B6B6" } }, font: { bold: true, color: { rgb: "7F1D1D" }, sz: 11 }, alignment: { vertical: "center" } };
const MINIHEAD = { fill: { patternType: "solid", fgColor: { rgb: "F2F2F2" } }, font: { bold: true, color: { rgb: "3D3D3A" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: BORDER };
const MINIVAL = { fill: { patternType: "solid", fgColor: { rgb: "BDD7EE" } }, alignment: { horizontal: "center" }, border: BORDER };
const COLHEAD = { fill: { patternType: "solid", fgColor: { rgb: "44546A" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: BORDER };
const DETAILHEAD = COLHEAD;
const KEY_CLIENT = { fill: { patternType: "solid", fgColor: { rgb: "2E75B6" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center" } };
const KEY_CMS = { fill: { patternType: "solid", fgColor: { rgb: "C55A11" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center" } };
const KEY_ANALYTIC = { fill: { patternType: "solid", fgColor: { rgb: "1F3864" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center" } };
const FEEREF: Record<string, string> = {
  "Conditional Packaging (SI=Q1-Q4)": "CPT Addendum B / OPPS SI", "Bundled (SI=B)": "CPT Addendum B / OPPS SI",
  "Pass-Through & New Technology": "CPT Addendum B / ASP", "Pass-Through ASP Markup": "ASP / Part B",
  "Retired HCPCS": "CPT Addendum B", "Underpriced vs Fee Schedule": "MPFS", "SI=A Non-OPPS Fee Schedule": "MPFS/CLFS/DMEPOS",
  "Device-Procedure Crosswalk": "OPPS I/OCE Device Edit", "Self-Admin Drugs (Rev 637)": "Rev 637 / MBPM Ch.15",
  "Price Transparency (Shoppable Services)": "45 CFR 180", "Vaccine Admin Coding": "CMS Vaccine Admin FS",
  "Billing Unit / Multiplier": "ASP / NDC billing unit", "Multi Rev Code": "R&U Detail", "Bilateral Pricing": "MC Fee Schedule",
  "Pricing - Outlier": "Rev-family median", "Consistency": "MC Fee Schedule", "Revenue Code": "UB-04 Rev Code",
};
const PRIO: Record<string, any> = {
  CRITICAL: { fill: { patternType: "solid", fgColor: { rgb: "C00000" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center" }, border: BORDER },
  HIGH: { fill: { patternType: "solid", fgColor: { rgb: "ED7D31" } }, font: { bold: true, color: { rgb: "FFFFFF" } }, alignment: { horizontal: "center" }, border: BORDER },
  MEDIUM: { fill: { patternType: "solid", fgColor: { rgb: "FFC000" } }, font: { bold: true, color: { rgb: "000000" } }, alignment: { horizontal: "center" }, border: BORDER },
  LOW: { fill: { patternType: "solid", fgColor: { rgb: "D9D9D9" } }, alignment: { horizontal: "center" }, border: BORDER },
  INFO: { alignment: { horizontal: "center" }, border: BORDER },
};

const E = XLSX.utils.encode_cell;
function sty(ws: any, r: number, c: number, s: any) { const a = E({ r, c }); if (!ws[a]) ws[a] = { t: "s", v: "" }; ws[a].s = { ...(ws[a].s || {}), ...s }; }
function styRow(ws: any, r: number, ncol: number, s: any) { for (let c = 0; c < ncol; c++) sty(ws, r, c, s); }
function merge(ws: any, r: number, c1: number, c2: number) { (ws["!merges"] = ws["!merges"] || []).push({ s: { r, c: c1 }, e: { r, c: c2 } }); }
function money(ws: any, r: number, c: number) { const a = E({ r, c }); if (ws[a] && typeof ws[a].v === "number") { ws[a].z = MONEY; ws[a].s = { ...(ws[a].s || {}), numFmt: MONEY }; } }
function autofilter(ws: any, rows: number, cols: number) { ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows - 1, c: cols - 1 } }) }; }
function styleDetailHeader(ws: any, ncol: number, rows: number) { styRow(ws, 0, ncol, DETAILHEAD); autofilter(ws, rows, ncol); }

async function pageAll(qFactory: (from: number, to: number) => any) {
  const out: any[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await qFactory(off, off + 999);
    if (error || !data || data.length === 0) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const auditId = searchParams.get("auditId");
    const format = searchParams.get("format") || "csv";
    if (!auditId) return NextResponse.json({ error: "Missing auditId" }, { status: 400 });

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } });
    const sessionClient = await createSessionClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { data: audit } = await db.from("audits").select("hospital_name, name").eq("id", auditId).single();
    const findings = await pageAll((from, to) => db.from("findings")
      .select("*, charge_items(procedure_number, charge_description, hcpcs_cpt_code, revenue_code, gross_charge, department)")
      .eq("audit_id", auditId).order("severity").range(from, to));

    const hospitalName = (audit?.hospital_name || "audit").replace(/[^a-zA-Z0-9]/g, "_");
    const date = new Date().toISOString().split("T")[0];

    if (format === "xlsx" || format === "report") {
      const usage = await pageAll((from, to) => db.from("charge_usage")
        .select("charge_code, hcpcs, department, units, gross, visits, medicare, mc_adv, mc_ma")
        .eq("audit_id", auditId).range(from, to));
      const usageByCode = new Map<string, any>();
      for (const u of usage) if (u.charge_code) usageByCode.set(String(u.charge_code), u);
      const items = await pageAll((from, to) => db.from("charge_items")
        .select("procedure_number, charge_description, hcpcs_cpt_code, revenue_code, gross_charge, department")
        .eq("audit_id", auditId).order("procedure_number").range(from, to));

      const T = {
        gross: usage.reduce((s, u) => s + num(u.gross), 0), units: usage.reduce((s, u) => s + num(u.units), 0),
        visits: usage.reduce((s, u) => s + num(u.visits), 0), medicare: usage.reduce((s, u) => s + num(u.medicare), 0),
        mcadv: usage.reduce((s, u) => s + num(u.mc_adv), 0), mcma: usage.reduce((s, u) => s + num(u.mc_ma), 0),
      };
      const hasRU = usage.length > 0;

      const byCat = new Map<string, any[]>();
      for (const f of findings) { const c = f.category || "Uncategorized"; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c)!.push(f); }
      const summary = [...byCat.entries()].map(([cat, fs]) => {
        const codes = new Set<string>(); let grossImpact = 0, mcmaImpact = 0;
        const sevCount: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 }; let topSev = "info";
        for (const f of fs) {
          sevCount[f.severity] = (sevCount[f.severity] || 0) + 1;
          if ((SEV_ORDER[f.severity] ?? 9) < (SEV_ORDER[topSev] ?? 9)) topSev = f.severity;
          const code = f.charge_items?.procedure_number;
          if (code && !codes.has(String(code))) { codes.add(String(code)); const u = usageByCode.get(String(code)); if (u) { grossImpact += num(u.gross); mcmaImpact += num(u.mc_ma); } }
        }
        return { cat, n: fs.length, sevCount, priority: PRIORITY[topSev] || "INFO", grossImpact, mcmaImpact, action: fs[0]?.recommendation || "" };
      }).sort((a, b) => b.grossImpact - a.grossImpact || b.n - a.n);

      const wb = XLSX.utils.book_new();
      const r0 = (v: number) => Math.round(v);

      // ── Executive Summary (Greg layout: col-A margin, slate banners, mini-tables) ──
      const M = 1;              // blank column A margin (content starts at col B)
      const LAST = M + 10;      // 11 content columns (B..L)
      const pct = (v: number) => (T.gross ? ((v / T.gross) * 100).toFixed(1) + "%" : "0%");
      const deptGross = (re: RegExp) => usage.filter((u) => re.test((u.department || "").toUpperCase())).reduce((s, u) => s + num(u.gross), 0);
      const pharmG = deptGross(/PHARMAC/), labG = deptGross(/\bLAB/), supG = deptGross(/SUPPL/);
      const blank = () => Array(LAST + 1).fill("");
      const row = (...vals: any[]) => { const a = blank(); vals.forEach((v, i) => (a[M + i] = v)); return a; };

      const exec: any[][] = [
        row(`HOSPITAL CDM ANALYSIS REPORT — ${audit?.hospital_name || ""}`),
        row(hasRU
          ? `${Math.round(T.visits).toLocaleString()} visits  |  $${r0(T.gross).toLocaleString()} Gross Charges  |  Pharmacy $${r0(pharmG).toLocaleString()}  |  Lab $${r0(labG).toLocaleString()}  |  Supplies $${r0(supG).toLocaleString()}`
          : `${audit?.name || ""}  |  Generated ${date}  |  ${findings.length.toLocaleString()} findings  |  (import R&U for revenue scope)`),
        blank(),
        row("CDM & REVENUE SCOPE"),
        row("Hospital CDM Lines", "Lines with HCPCS", "2025 Gross Charges", "Pharmacy Lines", "Lab Lines", "Supply Lines", "Retired HCPCS"),
        row(items.length, items.filter((i) => (i.hcpcs_cpt_code || "").trim()).length, hasRU ? r0(T.gross) : "(import R&U)",
          items.filter((i) => (i.revenue_code || "").trim().startsWith("25")).length,
          items.filter((i) => /^3[01]/.test((i.revenue_code || "").trim())).length,
          items.filter((i) => (i.revenue_code || "").trim().startsWith("27")).length,
          (byCat.get("Retired HCPCS") || []).length),
        blank(),
        row("2025 PAYER MIX  (R&U Gross Charges)"),
        row("Medicare", "MC Advantage", "MC+MA Total", "Other (Commercial/BCBS/Medicaid/Self-Pay)"),
        row(hasRU ? r0(T.medicare) : "(import R&U)", hasRU ? r0(T.mcadv) : "", hasRU ? r0(T.mcma) : "", hasRU ? r0(T.gross - T.mcma) : ""),
        row(hasRU ? pct(T.medicare) : "", hasRU ? pct(T.mcadv) : "", hasRU ? pct(T.mcma) : "", hasRU ? pct(T.gross - T.mcma) : ""),
        row("COLUMN HEADER COLOR KEY:", "CLIENT DATA", "", "CMS / REGULATORY", "", "ANALYTICAL / COMPUTED"),
        blank(),
        row("FLAGS REQUIRING REVIEW — RANKED BY FINANCIAL EXPOSURE"),
        row("Flag", "Count", "Priority", "Gross $ Impact", "MC+MA $ Impact", "Fee Schedule Ref", "R&U Data", "Key Findings", "Flag Definition", "Questions"),
        ...summary.map((r) => {
          const f0 = byCat.get(r.cat)![0];
          return row(r.cat, r.n, r.priority, hasRU ? r0(r.grossImpact) : "", hasRU ? r0(r.mcmaImpact) : "",
            FEEREF[r.cat] || "—", hasRU ? "Yes" : "No",
            `${r.n} findings (C/H/M/L ${r.sevCount.critical}/${r.sevCount.high}/${r.sevCount.medium}/${r.sevCount.low})${hasRU ? `; $${r0(r.grossImpact).toLocaleString()} R&U gross` : ""}`,
            f0?.description || "", f0?.recommendation || "");
        }),
      ];
      const ews = XLSX.utils.aoa_to_sheet(exec);
      ews["!cols"] = [{ wch: 3 }, { wch: 38 }, { wch: 9 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 9 }, { wch: 46 }, { wch: 50 }, { wch: 46 }];
      sty(ews, 0, M, TITLE); merge(ews, 0, M, LAST);
      sty(ews, 1, M, SUBTITLE); merge(ews, 1, M, LAST);
      sty(ews, 3, M, SECTION); merge(ews, 3, M, LAST);
      for (let c = M; c <= M + 6; c++) { sty(ews, 4, c, MINIHEAD); sty(ews, 5, c, MINIVAL); } money(ews, 5, M + 2);
      sty(ews, 7, M, SECTION); merge(ews, 7, M, LAST);
      for (let c = M; c <= M + 3; c++) { sty(ews, 8, c, MINIHEAD); sty(ews, 9, c, MINIVAL); money(ews, 9, c); sty(ews, 10, c, { font: { italic: true }, alignment: { horizontal: "center" } }); }
      sty(ews, 11, M, { font: { bold: true } }); sty(ews, 11, M + 1, KEY_CLIENT); sty(ews, 11, M + 3, KEY_CMS); sty(ews, 11, M + 5, KEY_ANALYTIC);
      sty(ews, 13, M, FLAGBANNER); merge(ews, 13, M, LAST);
      for (let c = M; c <= LAST; c++) sty(ews, 14, c, COLHEAD);
      for (let i = 0; i < summary.length; i++) {
        const r = 15 + i;
        for (let c = M; c <= LAST; c++) sty(ews, r, c, { border: BORDER, alignment: { vertical: "top", wrapText: true } });
        sty(ews, r, M, { font: { bold: true }, alignment: { vertical: "top", wrapText: true }, border: BORDER });
        sty(ews, r, M + 2, PRIO[summary[i].priority] || PRIO.INFO);
        money(ews, r, M + 3); money(ews, r, M + 4);
      }
      XLSX.utils.book_append_sheet(wb, ews, "Executive Summary");

      // ── Impact Analysis ──
      const totalGI = summary.reduce((s, r) => s + r.grossImpact, 0);
      const iaoa = [["IMPACT ANALYSIS — flags ranked by R&U gross exposure"], [],
        ["Flag", "Count", "Gross $ Impact", "MC+MA $ Impact", "% of Flagged Gross"],
        ...summary.map((r) => [r.cat, r.n, r0(r.grossImpact), r0(r.mcmaImpact), totalGI ? ((r.grossImpact / totalGI) * 100).toFixed(1) + "%" : "0%"])];
      const iws = XLSX.utils.aoa_to_sheet(iaoa);
      iws["!cols"] = [{ wch: 40 }, { wch: 9 }, { wch: 18 }, { wch: 18 }, { wch: 16 }];
      sty(iws, 0, 0, SECTION); merge(iws, 0, 0, 4); styRow(iws, 2, 5, COLHEAD);
      for (let i = 0; i < summary.length; i++) { const r = 3 + i; styRow(iws, r, 5, { border: BORDER }); money(iws, r, 2); money(iws, r, 3); }
      XLSX.utils.book_append_sheet(wb, iws, "Impact Analysis");

      // ── Dept Revenue Summary ──
      if (hasRU) {
        const byDept = new Map<string, any>();
        for (const u of usage) { const d = u.department || "(none)"; const a = byDept.get(d) || { gross: 0, units: 0, visits: 0, medicare: 0, mcadv: 0, mcma: 0 }; a.gross += num(u.gross); a.units += num(u.units); a.visits += num(u.visits); a.medicare += num(u.medicare); a.mcadv += num(u.mc_adv); a.mcma += num(u.mc_ma); byDept.set(d, a); }
        const deptRows = [...byDept.entries()].sort((a, b) => b[1].gross - a[1].gross);
        const daoa = [["DEPARTMENT REVENUE SUMMARY (R&U)"], [],
          ["Department", "Gross Charges", "Units", "Visits", "Medicare $", "MC Advantage $", "MC+MA Total", "MC+MA %"],
          ...deptRows.map(([d, a]) => [d, r0(a.gross), r0(a.units), r0(a.visits), r0(a.medicare), r0(a.mcadv), r0(a.mcma), a.gross ? ((a.mcma / a.gross) * 100).toFixed(1) + "%" : "0%"])];
        const dws = XLSX.utils.aoa_to_sheet(daoa);
        dws["!cols"] = [{ wch: 32 }, { wch: 16 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 9 }];
        sty(dws, 0, 0, SECTION); merge(dws, 0, 0, 7); styRow(dws, 2, 8, COLHEAD);
        for (let i = 0; i < deptRows.length; i++) { const r = 3 + i; styRow(dws, r, 8, { border: BORDER }); [1, 4, 5, 6].forEach((c) => money(dws, r, c)); }
        XLSX.utils.book_append_sheet(wb, dws, "Dept Revenue Summary");
      }

      // ── Per-category detail tabs ──
      const detailHeaders = ["Severity", "Status", "Finding", "Description", "Recommendation", "Gross $ (R&U)", "MC+MA $ (R&U)", "Proc #", "Charge Description", "HCPCS/CPT", "Rev Code", "Gross Charge", "Department"];
      const used = new Set<string>();
      const sheetName = (cat: string) => { let nm = cat.replace(/[[\]:*?/\\]/g, "").slice(0, 28) || "Findings"; const b = nm; let i = 1; while (used.has(nm)) nm = b.slice(0, 25) + "_" + i++; used.add(nm); return nm; };
      for (const r of summary) {
        const fs = byCat.get(r.cat)!.slice().sort((a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9));
        const aoa = [detailHeaders, ...fs.map((f) => { const u = usageByCode.get(String(f.charge_items?.procedure_number || "")); return [f.severity, f.status, f.title, f.description || "", f.recommendation || "", u ? r0(num(u.gross)) : "", u ? r0(num(u.mc_ma)) : "", f.charge_items?.procedure_number || "", f.charge_items?.charge_description || "", f.charge_items?.hcpcs_cpt_code || "", f.charge_items?.revenue_code || "", f.charge_items?.gross_charge || "", f.charge_items?.department || ""]; })];
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws["!cols"] = [{ wch: 9 }, { wch: 8 }, { wch: 44 }, { wch: 55 }, { wch: 48 }, { wch: 13 }, { wch: 13 }, { wch: 10 }, { wch: 32 }, { wch: 11 }, { wch: 9 }, { wch: 12 }, { wch: 22 }];
        styleDetailHeader(ws, detailHeaders.length, aoa.length);
        for (let i = 1; i < aoa.length; i++) { money(ws, i, 5); money(ws, i, 6); }
        XLSX.utils.book_append_sheet(wb, ws, sheetName(r.cat));
      }

      // ── Hospital CDM + All Flags ──
      const flagsByItem = new Map<string, Set<string>>();
      for (const f of findings) { const code = String(f.charge_items?.procedure_number || ""); if (!code) continue; if (!flagsByItem.has(code)) flagsByItem.set(code, new Set()); flagsByItem.get(code)!.add(f.category || ""); }
      const mh = ["CDM Code", "Department", "Description", "Rev Code", "HCPCS", "Price", "R&U Units", "R&U Gross", "MC+MA", "Flags"];
      const maoa = [mh, ...items.map((it) => { const code = String(it.procedure_number || ""); const u = usageByCode.get(code); return [code, it.department || "", it.charge_description || "", it.revenue_code || "", it.hcpcs_cpt_code || "", it.gross_charge || "", u ? r0(num(u.units)) : "", u ? r0(num(u.gross)) : "", u ? r0(num(u.mc_ma)) : "", [...(flagsByItem.get(code) || [])].filter(Boolean).join("; ")]; })];
      const mws = XLSX.utils.aoa_to_sheet(maoa);
      mws["!cols"] = [{ wch: 10 }, { wch: 24 }, { wch: 34 }, { wch: 9 }, { wch: 10 }, { wch: 11 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 50 }];
      styleDetailHeader(mws, mh.length, maoa.length);
      for (let i = 1; i < maoa.length; i++) { [5, 7, 8].forEach((c) => money(mws, i, c)); }
      XLSX.utils.book_append_sheet(wb, mws, "Hospital CDM + All Flags");

      // ── R&U by Charge Code ──
      if (hasRU) {
        const ruh = ["Charge Code", "HCPCS", "Department", "Units", "Gross Charges", "Visits", "Medicare $", "MC Adv $", "MC+MA Total"];
        const ruaoa = [ruh, ...usage.map((u) => [u.charge_code, u.hcpcs, u.department, num(u.units), num(u.gross), num(u.visits), num(u.medicare), num(u.mc_adv), num(u.mc_ma)])];
        const rws = XLSX.utils.aoa_to_sheet(ruaoa);
        rws["!cols"] = [{ wch: 12 }, { wch: 10 }, { wch: 28 }, { wch: 12 }, { wch: 15 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 15 }];
        styleDetailHeader(rws, ruh.length, ruaoa.length);
        for (let i = 1; i < ruaoa.length; i++) { [4, 6, 7, 8].forEach((c) => money(rws, i, c)); }
        XLSX.utils.book_append_sheet(wb, rws, "R&U by Charge Code");
      }

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
      return new NextResponse(buf, { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="ChargeGuard_${hospitalName}_Report_${date}.xlsx"` } });
    }

    // ── CSV ──
    const headers = ["Severity", "Status", "Category", "Finding", "Description", "Recommendation", "Est. Financial Impact", "Procedure #", "Charge Description", "HCPCS/CPT", "Revenue Code", "Gross Charge", "Department"];
    const rows = findings.map((f: any) => [f.severity, f.status, f.category || "", f.title, (f.description || "").replace(/"/g, '""'), (f.recommendation || "").replace(/"/g, '""'), f.financial_impact || "", f.charge_items?.procedure_number || "", (f.charge_items?.charge_description || "").replace(/"/g, '""'), f.charge_items?.hcpcs_cpt_code || "", f.charge_items?.revenue_code || "", f.charge_items?.gross_charge || "", f.charge_items?.department || ""]);
    const csv = [headers.map((h) => `"${h}"`).join(","), ...rows.map((r) => r.map((c: any) => `"${c}"`).join(","))].join("\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="ChargeGuard_${hospitalName}_Findings_${date}.csv"` } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
