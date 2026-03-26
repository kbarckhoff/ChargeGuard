import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const auditId = searchParams.get("auditId");
    const format = searchParams.get("format") || "csv";
    const severity = searchParams.get("severity");
    const status = searchParams.get("status");
    const category = searchParams.get("category");

    if (!auditId) {
      return NextResponse.json({ error: "Missing auditId" }, { status: 400 });
    }

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

    // Get audit info
    const { data: audit } = await supabaseAdmin
      .from("audits")
      .select("hospital_name, name")
      .eq("id", auditId)
      .single();

    // Build query
    let query = supabaseAdmin
      .from("findings")
      .select("*, charge_items(procedure_number, charge_description, hcpcs_cpt_code, revenue_code, gross_charge, department)")
      .eq("audit_id", auditId)
      .order("severity")
      .order("created_at", { ascending: false });

    if (severity && severity !== "all") query = query.eq("severity", severity);
    if (status && status !== "all") query = query.eq("status", status);
    if (category && category !== "all") query = query.eq("category", category);

    const { data: findings, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Build CSV rows
    const headers = [
      "Severity",
      "Status",
      "Category",
      "Finding",
      "Description",
      "Recommendation",
      "Est. Financial Impact",
      "Procedure #",
      "Charge Description",
      "HCPCS/CPT",
      "Revenue Code",
      "Gross Charge",
      "Department",
    ];

    const rows = (findings || []).map((f: any) => [
      f.severity,
      f.status,
      f.category || "",
      f.title,
      (f.description || "").replace(/"/g, '""'),
      (f.recommendation || "").replace(/"/g, '""'),
      f.financial_impact || "",
      f.charge_items?.procedure_number || "",
      (f.charge_items?.charge_description || "").replace(/"/g, '""'),
      f.charge_items?.hcpcs_cpt_code || "",
      f.charge_items?.revenue_code || "",
      f.charge_items?.gross_charge || "",
      f.charge_items?.department || "",
    ]);

    // Generate CSV
    const csvContent = [
      headers.map((h) => `"${h}"`).join(","),
      ...rows.map((row) => row.map((cell: any) => `"${cell}"`).join(",")),
    ].join("\n");

    const hospitalName = (audit?.hospital_name || "audit").replace(/[^a-zA-Z0-9]/g, "_");
    const date = new Date().toISOString().split("T")[0];
    const filename = `ChargeGuard_${hospitalName}_Findings_${date}.csv`;

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
