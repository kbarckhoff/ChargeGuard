import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSessionClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

async function requireOwner() {
  const sc = await createSessionClient();
  const { data: { user } } = await sc.auth.getUser();
  if (!user) return { error: "Not authenticated", status: 401 as const };
  const db = admin();
  const { data: me } = await db.from("users").select("is_platform_owner").eq("id", user.id).single();
  if (!me?.is_platform_owner) return { error: "Not allowed", status: 403 as const };
  return { db };
}

// Update a hospital's details (name / contact email). Platform owner only.
export async function POST(request: Request) {
  try {
    const gate = await requireOwner();
    if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const db = gate.db;

    const { org_id, name, contact_email } = await request.json();
    if (!org_id) return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
    const patch: Record<string, any> = {};
    if (typeof name === "string" && name.trim()) patch.name = name.trim();
    if (typeof contact_email === "string") patch.contact_email = contact_email.trim() || null;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

    const { error } = await db.from("organizations").update(patch).eq("id", org_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message }, { status: 500 });
  }
}
