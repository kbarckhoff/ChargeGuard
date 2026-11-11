import { NextResponse } from "next/server";
import { resolveActiveOrg } from "@/lib/active-org";
import { getOrgSettings, currentQuarter, quarterLabel, nextQuarter } from "@/lib/org-settings";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Start a review run for a hospital. Honors the client's run cadence:
//   - "quarterly" clients get ONE run per calendar quarter; a second attempt in the
//     same quarter is blocked until the next quarter.
//   - "unlimited" clients can run anytime.
// Also blocks new runs once the client's access period has ended (platform owner
// bypasses both). New runs start clean (all rules on, no competitors).
export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { orgId: __org, isPlatformOwner } = await resolveActiveOrg(db, user.id);
    const userData = { org_id: __org };
    if (!userData) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { hospital_name, name: rawName } = await request.json();
    const name = String(rawName || "").trim();
    if (!hospital_name || !name) {
      return NextResponse.json({ error: "hospital_name and name are required" }, { status: 400 });
    }

    const { runCadence, accessExpired } = await getOrgSettings(db, __org);

    // Access window: once the client's access period has ended, no new reviews.
    if (accessExpired && !isPlatformOwner) {
      return NextResponse.json({ error: "This client's access period has ended. Contact Amelior to renew." }, { status: 403 });
    }

    const cur = currentQuarter();
    // Quarterly cadence: only one review per calendar quarter.
    if (runCadence === "quarterly" && !isPlatformOwner) {
      const { data: existing } = await db
        .from("audits")
        .select("id")
        .eq("org_id", __org)
        .eq("period_year", cur.year)
        .eq("period_quarter", cur.quarter)
        .neq("status", "archived")
        .limit(1)
        .maybeSingle();
      if (existing?.id) {
        const nx = nextQuarter(cur.year, cur.quarter);
        return NextResponse.json({
          error: `This client is on quarterly reviews. The ${quarterLabel(cur.year, cur.quarter)} review has already been run; the next one unlocks in ${quarterLabel(nx.year, nx.quarter)}.`,
          existingAuditId: existing.id,
        }, { status: 409 });
      }
    }

    // Create a fresh, clean run.
    const { data: newId, error } = await db.rpc("create_audit_with_phases", {
      p_org_id: userData.org_id,
      p_name: name,
      p_hospital_name: hospital_name,
      p_description: null,
      p_lead_auditor_id: user.id,
      p_start_date: new Date().toISOString().split("T")[0],
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // ChargeGuard supports short-term acute care only. Stamp the period so the
    // quarterly lock can see it (quarterly clients only; unlimited stay unscheduled).
    const update: Record<string, any> = { status: "in_progress", facility_type: "short_term_acute" };
    if (runCadence === "quarterly") { update.period_year = cur.year; update.period_quarter = cur.quarter; }
    await db.from("audits").update(update).eq("id", newId);

    return NextResponse.json({ success: true, auditId: newId, existing: false });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
