import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { seedOrgDepartments } from "@/lib/departments";
import { ACTIVE_ORG_COOKIE } from "@/lib/active-org";

export const runtime = "nodejs";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

// Platform owner creates a new client org, seeds its departments, and switches
// the active client to it. {name}
export async function POST(request: Request) {
  try {
    const sc = await createSessionClient();
    const { data: { user } } = await sc.auth.getUser();
    if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const db = admin();
    const { data: me } = await db.from("users").select("is_platform_owner").eq("id", user.id).single();
    if (!me?.is_platform_owner) return NextResponse.json({ error: "Only the platform owner can add clients" }, { status: 403 });

    const { name } = await request.json();
    const clean = String(name || "").trim();
    if (!clean) return NextResponse.json({ error: "A client name is required" }, { status: 400 });

    const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
    const { data: org, error } = await db
      .from("organizations")
      .insert({ name: clean, slug, contact_email: user.email || null })
      .select("id, name")
      .single();
    if (error || !org) return NextResponse.json({ error: error?.message || "Could not create client" }, { status: 500 });

    try { await seedOrgDepartments(db, org.id); } catch { /* non-fatal; re-seedable from Settings */ }

    (await cookies()).set(ACTIVE_ORG_COOKIE, org.id, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 90,
    });
    return NextResponse.json({ ok: true, org });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
