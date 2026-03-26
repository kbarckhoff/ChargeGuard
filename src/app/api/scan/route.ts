import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export const maxDuration = 60;

// ─── Rule Definitions ────────────────────────────────────────

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

// Revenue codes that REQUIRE a CPT/HCPCS code on outpatient claims
const REV_CODES_REQUIRING_HCPCS = [
  "025", "026", "027", "030", "031", "032", "033", "034", "035",
  "036", "037", "040", "041", "042", "043", "044", "045", "046",
  "047", "048", "049", "050", "051", "052", "053", "054", "055",
  "056", "057", "058", "059", "060", "061", "062", "063", "064",
  "070", "071", "072", "073", "074", "075", "076", "077", "078",
  "080", "082", "083", "084", "085", "088", "090", "091", "094",
];

// Keywords for DME items
const DME_KEYWORDS = [
  "wheelchair", "walker", "crutch", "brace", "prosthetic", "orthotic",
  "cpap", "bipap", "oxygen", "nebulizer", "commode", "cane", "bed",
  "mattress", "trapeze", "traction", "splint", "collar", "boot",
];

// Keywords for blood products
const BLOOD_KEYWORDS = [
  "whole blood", "packed red", "red blood cell", "rbc", "platelet",
  "plasma", "cryoprecipitate", "cryo", "fresh frozen", "ffp",
  "blood product", "transfusion", "blood component",
];

// Keywords for implants
const IMPLANT_KEYWORDS = [
  "implant", "prosthesis", "prosthetic", "pacemaker", "defibrillator",
  "stent", "graft", "fixation", "screw", "plate", "rod", "cage",
  "mesh", "valve", "spacer", "anchor", "coil", "catheter implant",
  "neurostimulator", "cochlear", "lens implant", "joint replacement",
];

// Keywords for non-billable / convenience items
const NON_BILLABLE_KEYWORDS = [
  "convenience", "comfort item", "personal item", "telephone",
  "tv rental", "television", "guest meal", "guest tray",
  "take home", "take-home", "hygiene kit", "amenity",
  "cosmetic", "non-covered", "noncovered",
];

// Revenue code to CPT range mapping (first 3 digits of rev code → valid CPT ranges)
const REV_CODE_CPT_RANGES: Record<string, { min: number; max: number; alpha?: string[] }[]> = {
  "025": [{ min: 0, max: 0, alpha: ["J", "A", "C", "Q"] }], // Pharmacy → J-codes
  "026": [{ min: 96360, max: 96379 }], // IV Therapy
  "030": [{ min: 80000, max: 89999 }], // Lab
  "031": [{ min: 80000, max: 89999 }], // Lab
  "032": [{ min: 70000, max: 76999 }], // Radiology - Diagnostic
  "033": [{ min: 77000, max: 77999 }], // Radiology - Therapeutic
  "034": [{ min: 78000, max: 79999 }], // Nuclear Medicine
  "035": [{ min: 70000, max: 76999 }], // CT Scan
  "036": [{ min: 10000, max: 69999 }], // Operating Room → Surgical
  "037": [{ min: 100, max: 1999 }],    // Anesthesia
  "041": [{ min: 94000, max: 94999 }], // Respiratory
  "042": [{ min: 97000, max: 97999 }], // PT
  "043": [{ min: 97000, max: 97999 }], // OT
  "044": [{ min: 92500, max: 92700 }], // Speech
  "045": [{ min: 99281, max: 99285 }], // ER
  "048": [{ min: 93000, max: 93999 }], // Cardiology
  "051": [{ min: 99201, max: 99499 }], // Clinic
  "073": [{ min: 93000, max: 93042 }], // EKG
  "075": [{ min: 43200, max: 45398 }], // GI
};

function runRules(items: any[]): RuleResult[] {
  const results: RuleResult[] = [];

  // Pre-compute groupings for duplicate and pricing rules
  const codeGroups = new Map<string, any[]>();
  const revCodePrices = new Map<string, number[]>();

  for (const item of items) {
    const code = item.hcpcs_cpt_code?.trim();
    const rev = item.revenue_code?.trim();
    const price = parseFloat(item.gross_charge) || 0;

    if (code && rev) {
      const key = `${code}|${rev}`;
      if (!codeGroups.has(key)) codeGroups.set(key, []);
      codeGroups.get(key)!.push(item);
    }
    if (rev) {
      const rev3 = rev.substring(0, 3);
      if (!revCodePrices.has(rev3)) revCodePrices.set(rev3, []);
      if (price > 0) revCodePrices.get(rev3)!.push(price);
    }
  }

  // Compute medians per rev code family for outlier detection
  const revCodeMedians = new Map<string, number>();
  for (const [rev3, prices] of revCodePrices) {
    if (prices.length >= 5) {
      const sorted = [...prices].sort((a, b) => a - b);
      revCodeMedians.set(rev3, sorted[Math.floor(sorted.length / 2)]);
    }
  }

  // Track duplicates already flagged
  const flaggedDupes = new Set<string>();

  for (const item of items) {
    const desc = (item.charge_description || "").toLowerCase();
    const code = (item.hcpcs_cpt_code || "").trim();
    const rev = (item.revenue_code || "").trim();
    const rev3 = rev.substring(0, 3);
    const price = parseFloat(item.gross_charge) || 0;
    const mod1 = (item.modifier_1 || "").trim().toUpperCase();
    const mod2 = (item.modifier_2 || "").trim().toUpperCase();
    const mod3 = (item.modifier_3 || "").trim().toUpperCase();
    const allMods = [mod1, mod2, mod3].filter(Boolean);
    const procNum = item.procedure_number || item.id;

    // ─── Rule S.2: No Revenue Code ─────────────────────
    if (!rev) {
      results.push({
        rule_id: "S.2",
        charge_item_id: item.id,
        title: `No revenue code assigned — ${procNum}`,
        description: `Charge item "${item.charge_description}" (${procNum}) has no revenue code. Cannot bill on UB-04 without a revenue code.`,
        severity: "critical",
        category: "Missing Code",
        recommendation: "Assign the appropriate UB-04 revenue code based on the department and service type.",
      });
    }

    // ─── Rule 1.10 / S.4: Missing CPT/HCPCS ───────────
    if (!code && rev) {
      const requiresHcpcs = REV_CODES_REQUIRING_HCPCS.some(
        (r) => rev3 === r || rev.startsWith(r)
      );
      if (requiresHcpcs) {
        results.push({
          rule_id: "S.4",
          charge_item_id: item.id,
          title: `Revenue code ${rev} requires HCPCS — none assigned — ${procNum}`,
          description: `Charge item "${item.charge_description}" uses revenue code ${rev} which requires a CPT/HCPCS code on outpatient claims, but none is assigned.`,
          severity: "high",
          category: "Missing Code",
          recommendation: "Assign the appropriate CPT/HCPCS code for this service. Claims submitted without the required HCPCS will be denied.",
        });
      }
    }

    // ─── Rule S.3: Vague/Missing Description ───────────
    if (!desc || desc.length < 3 || ["misc", "other", "supply", "charge", "fee", "item"].includes(desc.trim())) {
      results.push({
        rule_id: "S.3",
        charge_item_id: item.id,
        title: `Vague or missing description — ${procNum}`,
        description: `Charge item ${procNum} has description "${item.charge_description || "(blank)"}" which is too vague to identify the service.`,
        severity: "medium",
        category: "Description",
        recommendation: "Update the charge description to clearly identify the service, supply, or procedure.",
      });
    }

    // ─── Rule 6.5: Zero/Null Price ─────────────────────
    if (price <= 0 && item.is_active !== false) {
      results.push({
        rule_id: "6.5",
        charge_item_id: item.id,
        title: `Zero or missing price — ${procNum} (${code || "no code"})`,
        description: `Active charge item "${item.charge_description}" has a price of $${price.toFixed(2)}. Active CDM items should have a positive charge amount.`,
        severity: "high",
        category: "Pricing — Missing",
        recommendation: "Set an appropriate charge amount or deactivate this line item if no longer in use.",
      });
    }

    // ─── Rule 6.6: Extreme Price Outlier ───────────────
    if (price > 0 && rev3 && revCodeMedians.has(rev3)) {
      const median = revCodeMedians.get(rev3)!;
      if (median > 0) {
        const ratio = price / median;
        if (ratio > 5) {
          results.push({
            rule_id: "6.6",
            charge_item_id: item.id,
            title: `Price outlier (${ratio.toFixed(1)}x median) — ${procNum}`,
            description: `"${item.charge_description}" is priced at $${price.toLocaleString()} which is ${ratio.toFixed(1)}x the median ($${median.toLocaleString()}) for revenue code family ${rev3}x.`,
            severity: "medium",
            category: "Pricing — Outlier",
            financial_impact: Math.abs(price - median),
            recommendation: "Review pricing. This item is significantly higher than similar services in the same department.",
          });
        } else if (ratio < 0.05 && price > 0) {
          results.push({
            rule_id: "6.6",
            charge_item_id: item.id,
            title: `Price outlier (${(ratio * 100).toFixed(1)}% of median) — ${procNum}`,
            description: `"${item.charge_description}" is priced at $${price.toFixed(2)} which is only ${(ratio * 100).toFixed(1)}% of the median ($${median.toLocaleString()}) for revenue code family ${rev3}x.`,
            severity: "medium",
            category: "Pricing — Outlier",
            financial_impact: Math.abs(median - price),
            recommendation: "Review pricing. This item is significantly lower than similar services — may indicate a data entry error.",
          });
        }
      }
    }

    // ─── Rule 1.7: DME Keyword Check ───────────────────
    if (DME_KEYWORDS.some((kw) => desc.includes(kw))) {
      if (rev3 !== "027" && rev !== "0274") {
        results.push({
          rule_id: "1.7",
          charge_item_id: item.id,
          title: `DME item may need revenue code 0274 — ${procNum}`,
          description: `"${item.charge_description}" appears to be a DME item but uses revenue code ${rev} instead of 0274 (Medical/Surgical Supplies — DME).`,
          severity: "medium",
          category: "Revenue Code",
          recommendation: "Review if this item should use revenue code 0274 and an appropriate HCPCS L-code or A/E/K code.",
        });
      }
    }

    // ─── Rule 1.8: Blood Product Check ─────────────────
    if (BLOOD_KEYWORDS.some((kw) => desc.includes(kw))) {
      if (!rev.startsWith("038") && !rev.startsWith("039")) {
        results.push({
          rule_id: "1.8",
          charge_item_id: item.id,
          title: `Blood product may need 038X revenue code — ${procNum}`,
          description: `"${item.charge_description}" appears to be a blood product but uses revenue code ${rev}. Blood products should use the 038X series to avoid triggering the blood deductible.`,
          severity: "high",
          category: "Revenue Code",
          recommendation: "Assign the appropriate 038X revenue code (0380-0389) for blood and blood component charges.",
        });
      }
    }

    // ─── Rule 1.9: Implant Check ───────────────────────
    if (IMPLANT_KEYWORDS.some((kw) => desc.includes(kw))) {
      if (!["0275", "0276", "0278"].includes(rev) && !rev.startsWith("027")) {
        results.push({
          rule_id: "1.9",
          charge_item_id: item.id,
          title: `Implant may need implant revenue code — ${procNum}`,
          description: `"${item.charge_description}" appears to be an implant but uses revenue code ${rev}. Implants typically use 0275, 0276, or 0278.`,
          severity: "medium",
          category: "Revenue Code",
          recommendation: "Review if this item should use an implant-specific revenue code (0275 Pacemaker, 0276 Intraocular Lens, 0278 Other Implants).",
        });
      }
    }

    // ─── Rule 2.1: Non-Billable Keywords ───────────────
    if (NON_BILLABLE_KEYWORDS.some((kw) => desc.includes(kw))) {
      results.push({
        rule_id: "2.1",
        charge_item_id: item.id,
        title: `Possible non-billable item — ${procNum}`,
        description: `"${item.charge_description}" contains keywords suggesting this may be a convenience or non-billable item that should not be billed to Medicare.`,
        severity: "critical",
        category: "Compliance",
        recommendation: "Verify this item is billable to Medicare/payers. If it is a patient convenience item, ensure it is excluded from payer billing.",
      });
    }

    // ─── Rule 2.4: Hard-Coded Modifier 59/X{ESPU} ─────
    const badMods = allMods.filter((m) => ["59", "XE", "XS", "XP", "XU"].includes(m));
    if (badMods.length > 0) {
      results.push({
        rule_id: "2.4",
        charge_item_id: item.id,
        title: `Modifier ${badMods.join("/")} should not be hard-coded — ${procNum}`,
        description: `"${item.charge_description}" has modifier ${badMods.join("/")} hard-coded in the CDM. These are situational modifiers that should only be applied at the claim level based on the specific clinical scenario.`,
        severity: "high",
        category: "Modifier — Compliance Risk",
        recommendation: "Remove hard-coded modifier 59/XE/XS/XP/XU from the CDM. These modifiers should be applied during claim submission when clinically appropriate.",
      });
    }

    // ─── Rule 3.3: Unlisted Code Check ─────────────────
    if (code && /\d{4}9$/.test(code) && code.length === 5 && /^\d{5}$/.test(code)) {
      // CPT codes ending in 9 where the last digit is 9 and 4th digit is 9 → unlisted
      const prefix = code.substring(0, 3);
      if (code.endsWith("99") || (code[3] === "9" && code[4] === "9")) {
        results.push({
          rule_id: "3.3",
          charge_item_id: item.id,
          title: `Unlisted code ${code} — review for specific alternative — ${procNum}`,
          description: `"${item.charge_description}" uses code ${code} which appears to be an unlisted/unspecified procedure code. A more specific code may be available.`,
          severity: "medium",
          category: "Coding Opportunity",
          recommendation: "Review if a specific CPT/HCPCS code exists for this service. Unlisted codes require additional documentation and may delay reimbursement.",
        });
      }
    }

    // ─── Rule 1.3: Revenue Code ↔ CPT Range Mismatch ──
    if (code && rev3 && REV_CODE_CPT_RANGES[rev3]) {
      const ranges = REV_CODE_CPT_RANGES[rev3];
      const codeNum = parseInt(code);
      const isAlpha = /^[A-Z]/.test(code);

      let matched = false;
      for (const range of ranges) {
        if (range.alpha && isAlpha) {
          if (range.alpha.some((prefix) => code.startsWith(prefix))) {
            matched = true;
            break;
          }
        } else if (!isAlpha && !isNaN(codeNum)) {
          if (codeNum >= range.min && codeNum <= range.max) {
            matched = true;
            break;
          }
        }
      }

      if (!matched && !isAlpha && !isNaN(codeNum)) {
        results.push({
          rule_id: "1.3",
          charge_item_id: item.id,
          title: `Revenue code ${rev} may not match CPT ${code} — ${procNum}`,
          description: `"${item.charge_description}" uses revenue code ${rev} with CPT ${code}. The CPT code falls outside the expected range for this revenue code family.`,
          severity: "high",
          category: "Revenue Code Mismatch",
          recommendation: "Verify the revenue code and CPT code are correctly paired. Mismatches cause claim denials.",
        });
      }
    }

    // ─── Rule 1.11: Duplicate Check ────────────────────
    if (code && rev) {
      const dupeKey = `${code}|${rev}|${price.toFixed(2)}`;
      const group = codeGroups.get(`${code}|${rev}`);
      if (group && group.length > 1 && !flaggedDupes.has(dupeKey)) {
        // Check if same code, rev, AND price
        const samePrice = group.filter(
          (g) => (parseFloat(g.gross_charge) || 0).toFixed(2) === price.toFixed(2)
        );
        if (samePrice.length > 1) {
          flaggedDupes.add(dupeKey);
          results.push({
            rule_id: "1.11",
            charge_item_id: item.id,
            title: `Potential duplicate — ${code} / Rev ${rev} / $${price.toFixed(2)}`,
            description: `Found ${samePrice.length} charge items with the same HCPCS ${code}, revenue code ${rev}, and price $${price.toFixed(2)}. This may indicate duplicate CDM entries.`,
            severity: "medium",
            category: "Duplicate",
            recommendation: `Review the ${samePrice.length} items sharing code ${code}, rev ${rev}, price $${price.toFixed(2)}. Remove duplicates if they represent the same service.`,
          });
        }
      }

      // Also flag same code, different prices (Rule 3.2)
      if (group && group.length > 1) {
        const prices = group.map((g) => parseFloat(g.gross_charge) || 0).filter((p) => p > 0);
        if (prices.length > 1) {
          const minP = Math.min(...prices);
          const maxP = Math.max(...prices);
          if (minP > 0 && maxP / minP > 1.2) {
            const varKey = `3.2|${code}|${rev}`;
            if (!flaggedDupes.has(varKey)) {
              flaggedDupes.add(varKey);
              results.push({
                rule_id: "3.2",
                charge_item_id: item.id,
                title: `Price variance for ${code} — $${minP.toFixed(2)} to $${maxP.toFixed(2)}`,
                description: `Code ${code} with revenue code ${rev} has ${group.length} entries with prices ranging from $${minP.toFixed(2)} to $${maxP.toFixed(2)} (${((maxP / minP - 1) * 100).toFixed(0)}% variance).`,
                severity: "low",
                category: "Consistency",
                financial_impact: maxP - minP,
                recommendation: "Review whether different prices for the same code are intentional (e.g., different units) or a data error.",
              });
            }
          }
        }
      }
    }
  }

  return results;
}

// ─── API Route ───────────────────────────────────────────────

export async function POST(request: Request) {
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

    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("org_id")
      .eq("id", user.id)
      .single();
    if (!userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { auditId } = await request.json();
    if (!auditId) {
      return NextResponse.json({ error: "Missing auditId" }, { status: 400 });
    }

    // Fetch ALL charge items for this audit (paginated reads)
    let allItems: any[] = [];
    let offset = 0;
    const PAGE_SIZE = 5000;

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

    // Run all rules
    const ruleResults = runRules(allItems);

    // Get Phase I id for coding findings
    const { data: phases } = await supabaseAdmin
      .from("audit_phases")
      .select("id, phase_number")
      .eq("audit_id", auditId);

    const phaseMap: Record<string, string> = {};
    for (const p of phases || []) {
      phaseMap[p.phase_number] = p.id;
    }

    // Map rule to phase
    function ruleToPhase(ruleId: string): string | null {
      const prefix = ruleId.split(".")[0];
      const map: Record<string, number> = {
        "1": 1, "S": 1, "2": 2, "3": 3, "4": 4, "6": 6,
      };
      const phaseNum = map[prefix];
      return phaseNum ? phaseMap[phaseNum] || null : null;
    }

    // Clear previous scan findings for this audit (avoid duplicates on re-scan)
    await supabaseAdmin
      .from("findings")
      .delete()
      .eq("audit_id", auditId)
      .like("title", "%—%"); // Only delete auto-generated findings (they have "—" in title)

    // Insert findings in batches
    const findings = ruleResults.map((r) => ({
      audit_id: auditId,
      phase_id: ruleToPhase(r.rule_id),
      org_id: userData.org_id,
      charge_item_id: r.charge_item_id,
      title: r.title,
      description: r.description,
      severity: r.severity,
      status: "open",
      category: r.category,
      financial_impact: r.financial_impact || null,
      recommendation: r.recommendation,
      created_by: user.id,
    }));

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

    // Update audit finding count
    const { count } = await supabaseAdmin
      .from("findings")
      .select("id", { count: "exact", head: true })
      .eq("audit_id", auditId);

    await supabaseAdmin
      .from("audits")
      .update({ total_findings: count || 0 })
      .eq("id", auditId);

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
    return NextResponse.json({ error: "Scan failed", detail: err?.message }, { status: 500 });
  }
}
