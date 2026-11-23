import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { runReferenceRules, runDeviceCrosswalkRules, runCodingUpdateRules, runPriceTransparencyRules, runMultiplierRules, runFormularyRules, runBenchmarkRules, runModifierRules, runInternalPricingRules, runRvuRules } from "@/lib/cdm-reference-rules";
import { runClaimsRules } from "@/lib/claims-rules";
import { runChargeCapturePairRules, runChargeCaptureBatch2Rules, runDenialRules, runPricingVsPaidRules } from "@/lib/converge-rules";
import { runItemMasterRules } from "@/lib/item-master-rules";
import { runPtpUnbundlingRules, runMueRules } from "@/lib/ncci-rules";
import { loadRelevantPtp } from "@/lib/ncci";
import { runPeerCompetitorRules } from "@/lib/peer-rules";
import { isAuditLocked } from "@/lib/audit-lock";
import { getReference, normalizeHcpcs, loadReferenceFromDb } from "@/lib/cms-reference";
import { loadDeptMaps, isStructuralCategory } from "@/lib/departments";
import { changeFieldForCategory, AWAITING_SYNC_STATUSES } from "@/lib/change-log";
import { resolveActiveOrg } from "@/lib/active-org";
import { runRules } from "@/lib/structural-rules";
import { disabledRuleIdsForFacility, normalizeFacility } from "@/lib/rule-catalog";

export const maxDuration = 60;

// ─── Types ───────────────────────────────────────────────────

interface RuleResult {
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  category: string;
  financial_impact?: number;
  recommendation: string;
  charge_item_id: string;
  rule_id: string;
}

// ─── Reference Data from the reference CDM Review Tool ─────────────

// Revenue codes that REQUIRE a CPT/HCPCS code on outpatient claims

// ─── API Route ───────────────────────────────────────────────

export async function POST(request: Request) {
  let guardAuditId: string | null = null;
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const sessionClient = await createSessionClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { orgId: __org } = await resolveActiveOrg(supabaseAdmin, user.id);
    const userData = __org ? { org_id: __org } : null;
    if (!userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { auditId } = await request.json();
    if (!auditId) {
      return NextResponse.json({ error: "Missing auditId" }, { status: 400 });
    }
    guardAuditId = auditId;
    if (await isAuditLocked(supabaseAdmin, auditId)) {
      return NextResponse.json({ error: "This quarter is completed (locked). Reopen it to run a scan." }, { status: 409 });
    }

    // Concurrency guard: two overlapping scans (e.g. an auto-scan racing a manual
    // one, or a double-click) each delete-then-insert and end up doubling the
    // findings. Refuse to start if another scan began in the last 5 minutes.
    {
      const { data: aRow } = await supabaseAdmin.from("audits").select("metadata").eq("id", auditId).single();
      const meta = ((aRow?.metadata as any) || {}) as Record<string, any>;
      const startedAt = meta.scan_started_at ? Date.parse(meta.scan_started_at) : 0;
      if (startedAt && Date.now() - startedAt < 5 * 60 * 1000) {
        return NextResponse.json({ error: "A scan is already running for this review. Please wait for it to finish." }, { status: 409 });
      }
      await supabaseAdmin.from("audits").update({ metadata: { ...meta, scan_started_at: new Date().toISOString() } }).eq("id", auditId);
    }

    // Fetch ALL charge items (paginated)
    let allItems: any[] = [];
    let offset = 0;
    const PAGE_SIZE = 1000; // Supabase/PostgREST caps responses at 1000 rows; page in 1000s so all items are scanned

    while (true) {
      const { data, error } = await supabaseAdmin
        .from("charge_items")
        .select("id, procedure_number, charge_description, hcpcs_cpt_code, revenue_code, gross_charge, department, modifier_1, modifier_2, modifier_3, is_active, ndc_code")
        .eq("audit_id", auditId)
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        console.error("Fetch error:", JSON.stringify(error));
        return NextResponse.json({ error: "Failed to fetch charge items" }, { status: 500 });
      }

      if (!data || data.length === 0) break;
      allItems = allItems.concat(data);
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    if (allItems.length === 0) {
      return NextResponse.json({ error: "No charge items found for this audit" }, { status: 404 });
    }

    // Load R&U + formulary (by charge code) for the formulary rules, if present.
    const usageByCode = new Map<string, any>();
    const formularyByCode = new Map<string, any>();
    for (let off = 0; ; off += 1000) {
      const { data } = await supabaseAdmin.from("charge_usage").select("charge_code, units, gross, modifier").eq("audit_id", auditId).range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const u of data) if (u.charge_code) usageByCode.set(String(u.charge_code), u);
      if (data.length < 1000) break;
    }
    for (let off = 0; ; off += 1000) {
      const { data } = await supabaseAdmin.from("charge_formulary").select("charge_code, status, ndc, drug_name, pkg_amt, pkg_unit").eq("audit_id", auditId).range(off, off + 999);
      if (!data || data.length === 0) break;
      for (const f of data) if (f.charge_code) formularyByCode.set(String(f.charge_code), f);
      if (data.length < 1000) break;
    }
    // Charge codes on the formulary — excluded from peer/benchmark pricing since
    // formularies differ across like facilities and aren't comparable.
    const formularyCodes = new Set<string>(formularyByCode.keys());

    // Load imported 837 claim lines (if any) for the Phase-2 claims rules.
    const claimLines: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data } = await supabaseAdmin.from("claim_lines").select("claim_id, rev_code, hcpcs, mod1, mod2, mod3, mod4, units, line_charge, service_date, dx_primary").eq("audit_id", auditId).range(off, off + 999);
      if (!data || data.length === 0) break;
      claimLines.push(...data);
      if (data.length < 1000) break;
    }

    // Load the de-identified claims extract + item master (Converge inputs) for
    // the Converge rule batch (charge-capture companions, denials, pricing-vs-paid,
    // item-master reconciliation).
    const claimsExtract: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data } = await supabaseAdmin.from("claims_extract").select("claim_id, hcpcs, rev_code, units, mod1, mod2, mod3, mod4, dx_code, billed_amount, allowed_amount, paid_amount, denial_code, payer").eq("audit_id", auditId).range(off, off + 999);
      if (!data || data.length === 0) break;
      claimsExtract.push(...data);
      if (data.length < 1000) break;
    }
    // NCCI PTP edits relevant to the codes billed on this review (bounded fetch).
    const claimCodes = new Set<string>();
    for (const r of claimsExtract) if (r.hcpcs) claimCodes.add(String(r.hcpcs));
    const ptpMap = claimsExtract.length ? await loadRelevantPtp(supabaseAdmin, claimCodes) : new Map();
    const itemMaster: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data } = await supabaseAdmin.from("item_master").select("item_number, description, hcpcs, rev_code, c_code, is_device, charge_code, is_active").eq("audit_id", auditId).range(off, off + 999);
      if (!data || data.length === 0) break;
      itemMaster.push(...data);
      if (data.length < 1000) break;
    }

    // Load competitor peer prices (if any) for the named-competitor benchmark.
    const peerRows: any[] = [];
    for (let off = 0; ; off += 1000) {
      const { data } = await supabaseAdmin.from("peer_prices").select("hcpcs, gross_charge, competitor").eq("audit_id", auditId).range(off, off + 999);
      if (!data || data.length === 0) break;
      peerRows.push(...data);
      if (data.length < 1000) break;
    }

    // Optional: benchmark against the client's own state if the audit records one;
    // otherwise the peer-pricing rule falls back to the national average.
    // select("*") avoids a hard error if the state column doesn't exist yet.
    let auditState: string | null = null;
    // Rules the client deactivated on the Intake page (empty = all active).
    const disabledRules = new Set<string>();
    // Review date drives effective-date awareness: a code not yet effective by the
    // review date should not be flagged. Low-volume threshold drives RVU analysis.
    let reviewDate: Date = new Date();
    let lowVolumeThreshold = 10;
    try {
      const { data: auditRow } = await supabaseAdmin.from("audits").select("*").eq("id", auditId).single();
      const raw = (auditRow?.state || auditRow?.hospital_state || auditRow?.state_code || "") as string;
      if (raw) auditState = String(raw).trim().toUpperCase().slice(0, 2);
      const dr = auditRow?.disabled_rules;
      if (Array.isArray(dr)) for (const r of dr) disabledRules.add(String(r));
      const md = (auditRow?.metadata || {}) as any;
      // review_period holds an ISO date (e.g. "2026-03-15"); fall back to start_date.
      const rp = String(md.review_period || "").trim();
      const parsed = rp ? new Date(rp) : (auditRow?.start_date ? new Date(auditRow.start_date) : null);
      if (parsed && !isNaN(parsed.getTime())) reviewDate = parsed;
      const lvt = Number(md.low_volume_threshold);
      if (Number.isFinite(lvt) && lvt >= 0) lowVolumeThreshold = lvt;
      // Facility-type scoping: a professional-fee practice or behavioral-health
      // program doesn't run the hospital OPPS rules. Add every catalog rule that
      // doesn't apply to this facility to the disabled set, so only the applicable
      // rules produce findings. Universal/engine-only rules are never in this list.
      const ft = normalizeFacility(auditRow?.facility_type);
      for (const id of disabledRuleIdsForFacility(ft)) disabledRules.add(id);
    } catch { /* national fallback */ }

    // Load the live CMS reference set from the DB (falls back to bundled JSON),
    // so the automatic quarterly refresh takes effect for every scan.
    await loadReferenceFromDb(supabaseAdmin);

    // Run all rules: self-contained structural rules + CMS reference-driven rules
    const ruleResultsAll = [
      ...runRules(allItems),
      ...runReferenceRules(allItems, usageByCode),
      ...runDeviceCrosswalkRules(allItems),
      ...runCodingUpdateRules(allItems, usageByCode),
      ...runPriceTransparencyRules(allItems),
      ...runMultiplierRules(allItems),
      ...runFormularyRules(allItems, formularyByCode, usageByCode),
      ...runModifierRules(allItems, usageByCode),
      ...runInternalPricingRules(allItems),
      ...runRvuRules(allItems, usageByCode, lowVolumeThreshold),
      ...runBenchmarkRules(allItems, auditState, formularyCodes),
      ...runClaimsRules(allItems, claimLines),
      ...runPeerCompetitorRules(allItems, peerRows, formularyCodes),
      // Converge batch 1 — rules that use the new de-identified inputs.
      ...runChargeCapturePairRules(allItems, claimsExtract),
      ...runChargeCaptureBatch2Rules(allItems, claimsExtract),
      ...runDenialRules(allItems, claimsExtract),
      ...runPricingVsPaidRules(allItems, claimsExtract),
      ...runItemMasterRules(allItems, itemMaster),
      // Converge batch 2 — NCCI PTP unbundling + MUE unit caps (reference-driven).
      ...runPtpUnbundlingRules(allItems, claimsExtract, ptpMap),
      ...runMueRules(allItems, claimsExtract),
    ];
    // Effective-date awareness: skip findings for CDM lines whose code/line is not
    // yet effective by the review date (e.g. a code effective 1/1/2026 in a 2025
    // review). The effective date, when present, comes through the CDM in raw_data.
    const effDateOf = (item: any): Date | null => {
      const rd = (item?.raw_data || {}) as Record<string, any>;
      for (const k of Object.keys(rd)) {
        if (/eff|effective|start/i.test(k)) {
          const v = String(rd[k] ?? "").trim();
          if (!v) continue;
          const d = new Date(v);
          if (!isNaN(d.getTime())) return d;
        }
      }
      return null;
    };
    const notYetEffective = new Set<string>();
    for (const it of allItems) {
      const d = effDateOf(it);
      if (d && d.getTime() > reviewDate.getTime()) notYetEffective.add(it.id);
    }

    // Drop findings the client deactivated and any line not yet effective this year.
    const ruleResults = ruleResultsAll.filter(
      (r) => !disabledRules.has(r.rule_id)
        && !(r.charge_item_id && notYetEffective.has(r.charge_item_id))
    );

    // Get phases for mapping
    const { data: phases } = await supabaseAdmin
      .from("audit_phases")
      .select("id, phase_number")
      .eq("audit_id", auditId);

    const phaseMap: Record<string, string> = {};
    for (const p of phases || []) {
      phaseMap[p.phase_number] = p.id;
    }

    function ruleToPhase(ruleId: string): string | null {
      const prefix = ruleId.split(".")[0];
      const map: Record<string, number> = {
        "1": 1, "S": 1, "2": 2, "3": 3, "6": 6, "R": 1, "A": 1, "L": 1,
        // reference-driven rules
        "8": 3, "15": 3, "12": 1, "10": 6, "U": 6, "637": 2, "2c": 1,
        "SIA": 6, "2b": 2, "NC": 3, "M": 1, "PT": 6, "7": 2, "INF": 2, "NDC": 2, "UOM": 2, "PBU": 2, "MK": 6,
        "BM": 6,
        // Phase-2 claims (837) rules
        "C25": 2, "C59": 2, "CNIC": 2, "CUNIT": 2,
        // Named-competitor peer pricing
        "PC": 6,
        // RVU / low-volume analysis
        "RVU": 6,
        // Converge batch 1 (new intake fields)
        "CC": 3, "CC2": 3, "DEN": 2, "PVP": 6, "IM": 1,
        // Converge batch 2 (NCCI)
        "NCCI": 2,
      };
      const phaseNum = map[prefix];
      return phaseNum ? phaseMap[phaseNum] || null : null;
    }

    // Clear previous scan findings for this audit before re-inserting.
    // (Delete ALL for the audit — the prior `.like("title","%-%")` filter missed
    // findings whose titles have no hyphen, e.g. Multi Rev Code / New Codes, so
    // they accumulated as duplicates on every re-scan.)
    await supabaseAdmin
      .from("findings")
      .delete()
      .eq("audit_id", auditId);

    // Auto-route each finding to a department: structural/coding issues ->
    // Revenue Cycle/HIM; everything else by the line's UB-04 revenue code; no
    // match -> Unassigned. Reviewers can override later.
    const { idByCode, deptIdByPrefix } = await loadDeptMaps(supabaseAdmin, userData.org_id);
    const revByItem: Record<string, string> = {};
    for (const it of allItems) revByItem[it.id] = it.revenue_code || "";
    const deptFor = (category: string, chargeItemId: string | null): string | null => {
      if (isStructuralCategory(category)) return idByCode["revenue_cycle"] || idByCode["unassigned"] || null;
      const d = (chargeItemId ? revByItem[chargeItemId] || "" : "").replace(/\D/g, "");
      const r4 = d ? (d.length >= 4 ? d.slice(0, 4) : d.padStart(4, "0")) : "";
      const p3 = r4.slice(0, 3);
      return (p3 && deptIdByPrefix[p3]) || idByCode["unassigned"] || null;
    };

    // Carry-forward: a finding rejected-with-reason in a prior run becomes a
    // standing exception (keyed to the CDM line + category). Auto-carry it here
    // unless the charge changed materially (> ~1%), in which case re-surface it
    // as open with a note so a stale acceptance can't hide a new problem.
    const procByItem: Record<string, string> = {};
    const hcpcsByItem: Record<string, string> = {};
    const chargeByItem: Record<string, number | null> = {};
    for (const it of allItems) {
      procByItem[it.id] = (it.procedure_number || "").toString().trim();
      hcpcsByItem[it.id] = (it.hcpcs_cpt_code || "").toString().trim();
      chargeByItem[it.id] = it.gross_charge ?? null;
    }
    const { data: exRows } = await supabaseAdmin
      .from("finding_exceptions")
      .select("id, line_key, category, reason, snapshot_charge, disposition, status, updated_at")
      .eq("org_id", userData.org_id);
    // Active exceptions (Denied / N/A) are carried forward; the disposition map
    // (any status, most recent) drives tiering of every finding on this run.
    const exByKey: Record<string, { id: string; reason: string | null; snapshot_charge: number | null; disposition: string | null }> = {};
    const dispByKey: Record<string, { disposition: string | null; updated_at: string | null }> = {};
    for (const e of exRows || []) {
      const key = `${(e as any).line_key}||${(e as any).category}`;
      if ((e as any).status === "active") exByKey[key] = e as any;
      const prev = dispByKey[key];
      const ts = (e as any).updated_at || null;
      if (!prev || (ts && (!prev.updated_at || ts > prev.updated_at))) {
        dispByKey[key] = { disposition: (e as any).disposition || null, updated_at: ts };
      }
    }
    const seenExceptionIds = new Set<string>();

    // Tier: 1 new · 2 previously accepted · 3 previously denied · 4 previously N/A.
    const tierFor = (r: RuleResult): number => {
      const lineKey = (r.charge_item_id ? (procByItem[r.charge_item_id] || hcpcsByItem[r.charge_item_id]) : "") || "";
      if (!lineKey || !r.category) return 1;
      const d = dispByKey[`${lineKey}||${r.category}`]?.disposition;
      if (d === "accepted") return 2;
      if (d === "rejected") return 3;
      if (d === "na") return 4;
      return 1;
    };

    // Lagging EHR: a finding re-found on this fresh upload that matches a change
    // already accepted + exported in a prior run (and not yet in the EHR) is
    // shown read-only under "Pending EHR Sync" instead of asked to Accept again.
    const { data: clRows } = await supabaseAdmin
      .from("cdm_change_log")
      .select("line_key, field, updated_at")
      .eq("org_id", userData.org_id)
      .in("status", AWAITING_SYNC_STATUSES as unknown as string[]);
    const laggingByKey: Record<string, { updated_at: string | null }> = {};
    for (const c of clRows || []) laggingByKey[`${(c as any).line_key}||${(c as any).field}`] = { updated_at: (c as any).updated_at };
    const laggingFor = (r: RuleResult) => {
      const lineKey = (r.charge_item_id ? (procByItem[r.charge_item_id] || hcpcsByItem[r.charge_item_id]) : "") || "";
      if (!lineKey || !r.category) return null;
      const hit = laggingByKey[`${lineKey}||${changeFieldForCategory(r.category)}`];
      if (!hit) return null;
      const when = hit.updated_at ? new Date(hit.updated_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "a prior review";
      return { note: `Approved ${when}; awaiting EHR implementation.` };
    };

    const carryFor = (r: RuleResult) => {
      const lineKey = (r.charge_item_id ? (procByItem[r.charge_item_id] || hcpcsByItem[r.charge_item_id]) : "") || "";
      if (!lineKey || !r.category) return null;
      const ex = exByKey[`${lineKey}||${r.category}`];
      if (!ex) return null;
      seenExceptionIds.add(ex.id);
      const disp = ex.disposition === "na" ? "na" : "rejected";
      const nowCharge = r.charge_item_id ? chargeByItem[r.charge_item_id] : null;
      const changed = disp === "rejected" && ex.snapshot_charge != null && nowCharge != null &&
        Math.abs(nowCharge - ex.snapshot_charge) / Math.max(Math.abs(ex.snapshot_charge), 1) > 0.01;
      const reason = ex.reason ? `"${ex.reason}"` : "no reason recorded";
      if (changed) {
        return {
          status: "open", is_carried: false,
          note: null as string | null,
          descAppend: ` [Previously denied (${reason}), but the charge changed from $${Number(ex.snapshot_charge).toFixed(2)} to $${Number(nowCharge).toFixed(2)} — please re-review.]`,
        };
      }
      const label = disp === "na" ? "N/A" : "denied";
      return {
        status: disp, is_carried: true,
        note: ex.reason ? `Carried from a prior review — ${ex.reason}` : `Carried from a prior review (${label}).`,
        descAppend: "",
      };
    };

    // Insert findings in batches. Precedence: a re-found approved change (lagging
    // EHR) takes over as read-only; else a prior rejection carries forward; else
    // it's a new open finding.
    const findings = ruleResults.map((r) => {
      const lagging = laggingFor(r);
      const carry = lagging ? null : carryFor(r);
      return {
        audit_id: auditId,
        phase_id: ruleToPhase(r.rule_id),
        org_id: userData.org_id,
        charge_item_id: r.charge_item_id,
        title: r.title,
        description: (r.description || "") + (carry?.descAppend || ""),
        severity: r.severity,
        status: lagging ? "accepted" : (carry?.status || "open"),
        category: r.category,
        financial_impact: r.financial_impact || null,
        recommendation: r.recommendation,
        owner_department_id: deptFor(r.category, r.charge_item_id),
        is_carried: carry?.is_carried || false,
        ehr_lagging: !!lagging,
        tier: tierFor(r),
        resolution_note: lagging ? lagging.note : (carry?.note || null),
        created_by: user.id,
      };
    });

    const BATCH_SIZE = 500;
    let inserted = 0;
    for (let i = 0; i < findings.length; i += BATCH_SIZE) {
      const batch = findings.slice(i, i + BATCH_SIZE);
      const { error } = await supabaseAdmin.from("findings").insert(batch);
      if (error) {
        console.error(`Finding insert error at ${i}:`, JSON.stringify(error));
      } else {
        inserted += batch.length;
      }
    }

    // Note which standing exceptions fired again this run.
    if (seenExceptionIds.size) {
      await supabaseAdmin
        .from("finding_exceptions")
        .update({ last_seen_audit_id: auditId, updated_at: new Date().toISOString() })
        .in("id", [...seenExceptionIds]);
    }

    // Update audit finding count
    const { count } = await supabaseAdmin
      .from("findings")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId);

    await supabaseAdmin
      .from("audits")
      .update({ total_findings: count || 0 })
      .eq("id", auditId);

    // Release the scan guard.
    try {
      const { data: aRow2 } = await supabaseAdmin.from("audits").select("metadata").eq("id", auditId).single();
      const meta2 = ((aRow2?.metadata as any) || {}) as Record<string, any>;
      delete meta2.scan_started_at;
      await supabaseAdmin.from("audits").update({ metadata: meta2 }).eq("id", auditId);
    } catch { /* the guard auto-expires after 5 min regardless */ }

    // Summary by rule
    const summary: Record<string, { count: number; severity: string }> = {};
    for (const r of ruleResults) {
      if (!summary[r.rule_id]) {
        summary[r.rule_id] = { count: 0, severity: r.severity };
      }
      summary[r.rule_id].count++;
    }

    return NextResponse.json({
      success: true,
      itemsScanned: allItems.length,
      findingsGenerated: inserted,
      totalFindings: count || 0,
      summary,
    });
  } catch (err: any) {
    console.error("Scan error:", err?.message || err);
    // Always release the scan guard on failure so a broken run can't block retries.
    try {
      if (guardAuditId) {
        const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
        const { data: aRow } = await db.from("audits").select("metadata").eq("id", guardAuditId).single();
        const m = ((aRow?.metadata as any) || {}) as Record<string, any>;
        delete m.scan_started_at;
        await db.from("audits").update({ metadata: m }).eq("id", guardAuditId);
      }
    } catch { /* flag auto-expires after 5 min anyway */ }
    return NextResponse.json({ error: "Scan failed", detail: err?.message }, { status: 500 });
  }
}
// engine: structural rules + CMS reference-driven rules (an expert consultant methodology)
