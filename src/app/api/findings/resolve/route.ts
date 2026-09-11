import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Fields on a charge line that a reviewer is allowed to correct when resolving a
// finding. Numeric fields are coerced; everything else is stored as-is.
const ALLOWED = new Set(["hcpcs_cpt_code", "gross_charge", "revenue_code", "charge_description", "modifier_1", "units_billed"]);
const NUMERIC = new Set(["gross_charge", "units_billed"]);

// Resolve a finding AND apply the confirmed correction to the chargemaster.
// The reviewer has already confirmed the exact field + new value in the UI, so
// this writes it to charge_items and records the before/after on the finding.
export async function POST(request: Request) {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const { findingId, field, newValue, note, applyToCdm = true } = await request.json();
    if (!findingId) return NextResponse.json({ error: "Missing findingId" }, { status: 400 });

    // Load the finding to get the linked charge line.
    const { data: finding, error: fErr } = await db.from("findings").select("id, charge_item_id, audit_id").eq("id", findingId).single();
    if (fErr || !finding) return NextResponse.json({ error: "Finding not found" }, { status: 404 });

    if (finding.audit_id) {
      const { data: aud } = await db.from("audits").select("status").eq("id", finding.audit_id).single();
      if (aud?.status === "completed") return NextResponse.json({ error: "This quarter is completed (locked)." }, { status: 409 });
    }

    const update: Record<string, unknown> = {
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: user.id,
      resolution_note: note || null,
    };

    // Apply the CDM change when the reviewer chose a field + value and the finding
    // is tied to a charge line.
    if (applyToCdm && field && finding.charge_item_id) {
      if (!ALLOWED.has(field)) return NextResponse.json({ error: "Field not editable" }, { status: 400 });

      const { data: item, error: iErr } = await db.from("charge_items").select(`id, ${field}`).eq("id", finding.charge_item_id).single();
      if (iErr || !item) return NextResponse.json({ error: "Charge line not found" }, { status: 404 });

      const oldVal = (item as any)[field];
      let val: any = newValue;
      if (NUMERIC.has(field)) {
        val = parseFloat(String(newValue).replace(/[$,]/g, ""));
        if (isNaN(val)) return NextResponse.json({ error: "New value must be a number" }, { status: 400 });
      }

      const { error: uErr } = await db.from("charge_items").update({ [field]: val }).eq("id", finding.charge_item_id);
      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

      update.applied_field = field;
      update.applied_old = oldVal == null ? "" : String(oldVal);
      update.applied_new = String(val);
    }

    const { error: rErr } = await db.from("findings").update(update).eq("id", findingId);
    if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

    return NextResponse.json({ success: true, applied: !!update.applied_field });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
