import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

// Vercel Hobby: API routes get 60s (vs 10s for Server Actions)
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Verify auth
    const sessionClient = await createSessionClient();
    const { data: { user } } = await sessionClient.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    // Get org_id
    const { data: userData } = await supabaseAdmin
      .from("users")
      .select("org_id")
      .eq("id", user.id)
      .single();
    if (!userData) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const { auditId, items, columnMappings, saveMappingAs } = await request.json();

    if (!auditId || !items || !columnMappings) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Optionally save the column mapping for reuse
    if (saveMappingAs) {
      const sampleHeaders = Object.values(columnMappings).filter(Boolean) as string[];
      await supabaseAdmin.from("cdm_import_configs").insert({
        org_id: userData.org_id,
        name: saveMappingAs,
        column_mappings: columnMappings,
        sample_headers: sampleHeaders,
        created_by: user.id,
      });
    }

    // Transform rows
    const chargeItems = items.map((row: Record<string, string>) => {
      const mapped: Record<string, unknown> = {
        audit_id: auditId,
        org_id: userData.org_id,
      };

      Object.entries(columnMappings).forEach(([targetCol, sourceCol]) => {
        if (sourceCol && row[sourceCol as string] !== undefined) {
          const val = String(row[sourceCol as string] || "");
          if (targetCol === "gross_charge") {
            mapped[targetCol] = parseFloat(val.replace(/[,$]/g, "")) || null;
          } else if (targetCol === "units_billed") {
            mapped[targetCol] = parseInt(val) || 1;
          } else {
            mapped[targetCol] = val || null;
          }
        }
      });

      if (!mapped.charge_description) {
        mapped.charge_description = "UNMAPPED";
      }

      return mapped;
    });

    // Batch insert — larger batches for speed
    const BATCH_SIZE = 2000;
    let inserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < chargeItems.length; i += BATCH_SIZE) {
      const batch = chargeItems.slice(i, i + BATCH_SIZE);
      const { error } = await supabaseAdmin.from("charge_items").insert(batch);
      if (error) {
        console.error(`Batch error at row ${i}:`, JSON.stringify(error));
        errors.push(`Row ${i}: ${error.message}`);
        // Continue with remaining batches instead of failing entirely
      } else {
        inserted += batch.length;
      }
    }

    // Update audit total
    await supabaseAdmin
      .from("audits")
      .update({ total_charge_items: inserted })
      .eq("id", auditId);

    return NextResponse.json({
      success: true,
      inserted,
      total: chargeItems.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error("Import error:", err?.message || err);
    return NextResponse.json(
      { error: "Import failed", detail: err?.message },
      { status: 500 }
    );
  }
}
