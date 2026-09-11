import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { normalizeHcpcs, getReference, refNum } from "@/lib/cms-reference";
import { descMatchScore, confidenceLabel } from "@/lib/peer-match";
import * as XLSX from "xlsx-js-style";

export const maxDuration = 60;

// Medicare reference rate for a code — the common yardstick charges are
// benchmarked against (OPPS APC payment, else lab/drug/physician fee schedule).
function cmsRate(code: string): number {
  const r = getReference(code);
  if (!r) return 0;
  return refNum(r.apc_payment) || refNum(r.clfs) || refNum(r.asp) || refNum(r.mc_fee) || 0;
}

// Drug/biological codes are billed per a small dosage unit defined by the HCPCS
// (e.g. J0881 = per 1 mcg), but each hospital's MRF lists the gross charge for
// whatever package/vial size it prices — with no unit field to normalize on.
// So a per-1-unit CDM line gets compared against a competitor's whole-vial
// charge, producing meaningless gaps ($15 vs $23,814). Drugs are reviewed
// against ASP by the rule engine instead, so we tag them here and pull them out
// of the peer market signal rather than reporting a false price gap.
function isDrugCode(code: string): boolean {
  if (/^J\d{4}$/.test(code)) return true;                 // J-codes: drugs/biologicals
  if (/^Q\d{4}$/.test(code)) return true;                 // many Q-codes are drugs
  const r = getReference(code);
  return !!(r && refNum(r.asp) > 0);                       // has a Part B ASP limit
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const auditId = url.searchParams.get("auditId");
    const format = url.searchParams.get("format");
    const fBelow = url.searchParams.get("below") === "1";
    const fTrusted = url.searchParams.get("trusted") === "1";
    const fQ = (url.searchParams.get("q") || "").trim().toLowerCase();
    if (!auditId) return NextResponse.json({ error: "Missing auditId" }, { status: 400 });

    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

    // Per-competitor gross price per HCPCS (a competitor listing a code more than
    // once is averaged), so we can show each competitor's price, the distribution
    // (min/median/max), and whether the client is below market.
    const peer = new Map<string, Map<string, { sum: number; n: number }>>();
    const allComps = new Set<string>();
    for (let off = 0; ; off += 1000) {
      const { data } = await db.from("peer_prices").select("hcpcs, gross_charge, competitor").eq("audit_id", auditId).range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const r of data) {
        const code = normalizeHcpcs(r.hcpcs);
        const g = parseFloat(String(r.gross_charge)) || 0;
        if (!code || g <= 0) continue;
        allComps.add(r.competitor);
        const byComp = peer.get(code) || new Map<string, { sum: number; n: number }>();
        const c = byComp.get(r.competitor) || { sum: 0, n: 0 };
        c.sum += g; c.n += 1; byComp.set(r.competitor, c);
        peer.set(code, byComp);
      }
      if (data.length < 1000) break;
    }
    const median = (arr: number[]) => {
      if (!arr.length) return 0;
      const s = [...arr].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };

    // Placeholder / filler pricing: when one competitor repeats the exact same
    // gross charge across many unrelated codes (e.g. $448 on 88 codes, $1.75 on
    // 15), that's a default fill in their MRF, not a real per-code charge — so it
    // can't be used as a market benchmark. Count how many distinct codes each
    // (competitor, price) covers, and treat a price shared across >= 15 codes as
    // a placeholder that we drop from the comparison.
    const PLACEHOLDER_MIN_CODES = 15;
    const compValueCodes = new Map<string, Map<number, number>>();
    for (const [, byComp] of peer) {
      for (const [name, agg] of byComp) {
        const price = Math.round(agg.sum / agg.n);
        const m = compValueCodes.get(name) || new Map<number, number>();
        m.set(price, (m.get(price) || 0) + 1);
        compValueCodes.set(name, m);
      }
    }
    const isPlaceholder = (name: string, price: number) => (compValueCodes.get(name)?.get(price) || 0) >= PLACEHOLDER_MIN_CODES;

    // One row per CDM charge line whose HCPCS a competitor also lists. Compare on
    // MARKUP OVER MEDICARE (charge ÷ CMS rate) — the professional yardstick — with
    // the peer average shown for market context. We also count how many CDM lines
    // share each code: a code on one line is a clean 1-to-1 comparison; a code on
    // several lines is ambiguous (usually a coding issue), so we flag it rather
    // than trust the price gap.
    const rows: any[] = [];
    const codeCount = new Map<string, number>();
    const summary = { below: 0, above: 0, at: 0, total: 0, noRate: 0, ambiguousLines: 0, ambiguousCodes: 0, drugExcluded: 0, placeholderDropped: 0 };
    for (let off = 0; ; off += 1000) {
      const { data } = await db.from("charge_items").select("procedure_number, hcpcs_cpt_code, gross_charge, charge_description").eq("audit_id", auditId).range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const r of data) {
        const code = normalizeHcpcs(r.hcpcs_cpt_code);
        const your = parseFloat(String(r.gross_charge)) || 0;
        if (!code || your <= 0) continue;
        const p = peer.get(code);
        if (!p) continue;
        // Per-competitor price for this code, dropping any competitor whose price
        // for this code is placeholder/filler pricing (see isPlaceholder).
        const comps: Record<string, number> = {};
        for (const [name, agg] of p) {
          const price = Math.round(agg.sum / agg.n);
          if (isPlaceholder(name, price)) continue;
          comps[name] = price;
        }
        // If every competitor for this code was filler, there's no real market to
        // compare against — drop the code and count it.
        if (Object.keys(comps).length === 0) { summary.placeholderDropped++; continue; }
        codeCount.set(code, (codeCount.get(code) || 0) + 1);
        const prices = Object.values(comps);
        const med = median(prices);
        const lo = Math.min(...prices);
        const hi = Math.max(...prices);
        const ref = cmsRate(code);
        const yourMk = ref > 0 ? Math.round((your / ref) * 10) / 10 : null;
        const peerMk = ref > 0 ? Math.round((med / ref) * 10) / 10 : null;
        // Compare the client's charge to the competitor median (both gross charges).
        const pct = med > 0 ? Math.round((your / med) * 100) : 100;
        const position = pct < 75 ? "below" : pct > 150 ? "above" : "at";
        const belowMarket = your < med;
        // Drugs are not comparable on gross charge (unit mismatch); count them in
        // their own bucket and keep them out of the below/above/at market signal.
        const drug = isDrugCode(code);
        if (drug) {
          summary.drugExcluded++;
        } else {
          summary[position as "below" | "above" | "at"]++;
          summary.total++;
        }
        if (ref <= 0) summary.noRate++;
        const conf = confidenceLabel(descMatchScore(r.charge_description || "", code));
        // Trust guardrails so a gap is only treated as a clean market read when
        // it's actually apples-to-apples:
        //  singleSource — only one competitor lists it (not a "market")
        //  nearCms      — peer price sits at ~Medicare rate (likely a cost / send-out
        //                 pass-through, not a comparable retail gross charge)
        //  extremeGap   — >5x or <0.2x the peer; confirm coding/context first
        const n = prices.length;
        const singleSource = n < 2;
        const nearCms = ref > 0 && med >= 0.75 * ref && med <= 1.25 * ref;
        const extremeGap = med > 0 && (your / med > 5 || your / med < 0.2);
        //  dispersed — the competitors disagree with EACH OTHER by more than 3x
        //  (e.g. $12,466 vs $1,589). With a thin sample the median then sits in a
        //  gap where no competitor actually prices, so it's not a real benchmark.
        const spread = lo > 0 ? hi / lo : 1;
        const dispersed = n >= 2 && spread > 3;
        //  Sample size — the price-transparency literature (RAND / KFF) treats a
        //  "market" as >=5 hospitals and won't report a benchmark below 3. We keep
        //  thin samples visible but never call them high-confidence.
        const sampleTier = n >= 5 ? "market" : n >= 3 ? "limited" : n === 2 ? "thin" : "single";
        //  peerOutlier — the peer benchmark itself is implausible vs Medicare
        //  (median markup > 6x or < 0.5x). Being "below" a peer who is themselves
        //  the outlier isn't a real opportunity.
        const peerOutlier = peerMk != null && (peerMk > 6 || peerMk < 0.5);
        const trustworthy = !drug && n >= 3 && !nearCms && !extremeGap && !dispersed && !peerOutlier && !(codeCount.get(code)! > 1);
        rows.push({ proc: r.procedure_number || "", code, desc: r.charge_description || "", your: Math.round(your), peer: Math.round(med), median: Math.round(med), min: lo, max: hi, comps, n, sampleTier, ref: ref > 0 ? Math.round(ref) : null, yourMk, peerMk, pct, position, belowMarket, conf, drug, singleSource, nearCms, extremeGap, dispersed, peerOutlier, spread: Math.round(spread * 10) / 10, trustworthy });
      }
      if (data.length < 1000) break;
    }
    // Annotate each row with how many CDM lines share its code, and whether the
    // comparison is clean (1 line) or ambiguous (>1 line, confirm coding first).
    for (const row of rows) {
      row.lines = codeCount.get(row.code) || 1;
      row.ambiguous = row.lines > 1;
      if (row.ambiguous) summary.ambiguousLines++;
    }
    summary.ambiguousCodes = [...codeCount.values()].filter((c) => c > 1).length;
    // Overall markup posture vs Medicare — the defensible, cross-code metric
    // (RAND pegs commercial at ~2.5x Medicare; a common CDM target band is
    // 2.5-3.0x). Computed over non-drug rows that have a Medicare rate.
    const yourMks = rows.filter((r) => !r.drug && r.yourMk != null).map((r) => r.yourMk);
    const peerMks = rows.filter((r) => !r.drug && r.peerMk != null).map((r) => r.peerMk);
    (summary as any).yourMarkupMedian = yourMks.length ? Math.round(median(yourMks) * 10) / 10 : null;
    (summary as any).peerMarkupMedian = peerMks.length ? Math.round(median(peerMks) * 10) / 10 : null;
    (summary as any).maxPeers = allComps.size;
    // Show the biggest, cleanest gaps first: clean 1-to-1 codes rank ahead of
    // ambiguous ones so the trustworthy findings are on top.
    rows.sort((a, b) => (Number(a.ambiguous) - Number(b.ambiguous)) || (Math.abs(b.pct - 100) - Math.abs(a.pct - 100)));

    if (format === "xlsx") {
      const header = ["Charge code", "HCPCS", "Description", "Your charge", "Medicare rate", "Your markup (x)", "Peer median charge", "Competitors", "Peer markup (x)", "% of peer median", "Position", "Lines on this code", "Match confidence", "Flag"];
      const aoa = [header, ...rows.map((r) => [r.proc, r.code, r.desc, r.your, r.ref ?? "n/a", r.yourMk ?? "n/a", r.peer, r.n, r.peerMk ?? "n/a", r.pct / 100, r.drug ? "Drug - review vs ASP" : r.position === "below" ? "Below market" : r.position === "above" ? "Above market" : "At market", r.lines, r.conf, (r.drug ? "Drug - units not comparable" : r.ambiguous ? "Ambiguous - confirm coding" : r.dispersed ? `Competitors disagree ${r.spread}x - verify` : r.peerOutlier ? "Peer benchmark off vs Medicare" : r.nearCms ? "Peer ~ Medicare (cost/send-out?)" : r.sampleTier === "single" ? "Single source" : r.sampleTier === "thin" ? "Thin sample (2 peers)" : "Comparable")])];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws["!cols"] = [{ wch: 14 }, { wch: 9 }, { wch: 40 }, { wch: 12 }, { wch: 13 }, { wch: 13 }, { wch: 14 }, { wch: 11 }, { wch: 13 }, { wch: 9 }, { wch: 14 }, { wch: 16 }, { wch: 15 }, { wch: 24 }];
      const HEAD = { fill: { patternType: "solid", fgColor: { rgb: "0F2A47" } }, font: { bold: true, color: { rgb: "FFFFFF" } } };
      for (let c = 0; c < header.length; c++) { const a = XLSX.utils.encode_cell({ r: 0, c }); if (ws[a]) ws[a].s = HEAD; }
      for (let i = 0; i < rows.length; i++) {
        for (const col of [3, 4, 6]) { const a = XLSX.utils.encode_cell({ r: i + 1, c: col }); if (ws[a] && typeof ws[a].v === "number") ws[a].z = "$#,##0"; }
        const pc = XLSX.utils.encode_cell({ r: i + 1, c: 9 }); if (ws[pc]) ws[pc].z = "0%";
      }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Peer Pricing (vs Medicare)");
      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
      const date = new Date().toISOString().split("T")[0];
      return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="Peer_Pricing_Comparison_${date}.xlsx"` } });
    }

    // Apply the UI filters (below-market / high-confidence / text search) to the
    // FULL result set here on the server, then cap what we send. Summary stats
    // above stay whole-dataset so the KPI cards don't move when a filter changes.
    const filtered = rows.filter((r) =>
      (!fBelow || (r.belowMarket && !r.drug)) &&
      (!fTrusted || r.trustworthy) &&
      (!fQ || String(r.code).toLowerCase().includes(fQ) || String(r.desc || "").toLowerCase().includes(fQ))
    );
    return NextResponse.json({ summary, competitors: [...allComps].sort(), matched: filtered.length, rows: filtered.slice(0, 200) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
