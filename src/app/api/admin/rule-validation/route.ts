import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { buildValidationReport, validationCsv } from "@/lib/rule-code-validation";

export const runtime = "nodejs";
export const maxDuration = 60;

// Platform-owner tool: validates the companion-charge rule code relationships
// against the live CMS reference (code exists, retired, OPPS status indicator and
// packaging, NCCI PTP edits between paired codes). GET returns JSON;
// ?format=csv downloads a sheet for the Rule-to-Source Map.
export async function GET(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: me } = await db.from("users").select("is_platform_owner").eq("id", user.id).single();
    if (!me?.is_platform_owner) return NextResponse.json({ error: "Platform owner only" }, { status: 403 });

    const report = await buildValidationReport(db);
    if (new URL(request.url).searchParams.get("format") === "csv") {
      return new NextResponse(validationCsv(report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="rule-code-validation-${report.generatedAt.slice(0, 10)}.csv"` } });
    }
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Validation failed" }, { status: 500 });
  }
}
