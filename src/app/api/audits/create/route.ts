import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

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

    const { hospital_name, name, description, start_date } = await request.json();

    if (!hospital_name || !name) {
      return NextResponse.json({ error: "Hospital name and audit name are required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin.rpc("create_audit_with_phases", {
      p_org_id: userData.org_id,
      p_name: name,
      p_hospital_name: hospital_name,
      p_description: description || null,
      p_lead_auditor_id: user.id,
      p_start_date: start_date || new Date().toISOString().split("T")[0],
    });

    if (error) {
      console.error("Create audit error:", JSON.stringify(error));
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, auditId: data });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
