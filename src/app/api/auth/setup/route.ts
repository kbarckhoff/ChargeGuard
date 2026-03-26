import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  try {
    // Create admin client INSIDE the handler to ensure env vars are available
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing env vars:", { 
        hasUrl: !!supabaseUrl, 
        hasKey: !!serviceRoleKey 
      });
      return NextResponse.json(
        { error: "Server configuration error" }, 
        { status: 500 }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

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
      console.error("Org creation error:", JSON.stringify(orgError));
      return NextResponse.json(
        { error: "Failed to create organization", detail: orgError.message }, 
        { status: 500 }
      );
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
      console.error("User creation error:", JSON.stringify(userError));
      // Rollback org
      await supabaseAdmin.from("organizations").delete().eq("id", org.id);
      return NextResponse.json(
        { error: "Failed to create user profile", detail: userError.message }, 
        { status: 500 }
      );
    }

    return NextResponse.json({ org_id: org.id, success: true });
  } catch (err: any) {
    console.error("Setup error:", err?.message || err);
    return NextResponse.json(
      { error: "Internal server error", detail: err?.message }, 
      { status: 500 }
    );
  }
}
