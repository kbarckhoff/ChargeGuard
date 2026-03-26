import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Use service role to bypass RLS for initial setup
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const { user_id, email, full_name, org_name } = await request.json();

    if (!user_id || !email || !full_name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Create organization
    const slug = (org_name || full_name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      + "-" + Date.now().toString(36);

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .insert({
        name: org_name || `${full_name}'s Organization`,
        slug,
        contact_email: email,
      })
      .select()
      .single();

    if (orgError) {
      console.error("Org creation error:", orgError);
      return NextResponse.json({ error: "Failed to create organization" }, { status: 500 });
    }

    // Create user record linked to org
    const { error: userError } = await supabaseAdmin
      .from("users")
      .insert({
        id: user_id,
        org_id: org.id,
        email,
        full_name,
        role: "admin",
        is_active: true,
      });

    if (userError) {
      console.error("User creation error:", userError);
      // Rollback org
      await supabaseAdmin.from("organizations").delete().eq("id", org.id);
      return NextResponse.json({ error: "Failed to create user profile" }, { status: 500 });
    }

    return NextResponse.json({ org_id: org.id, success: true });
  } catch (err) {
    console.error("Setup error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
